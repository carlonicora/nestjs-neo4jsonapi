import { Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { ClsService } from "nestjs-cls";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { CommunityRepository } from "../../../foundations/community/repositories/community.repository";
import { CompanyRepository } from "../../../foundations/company/repositories/company.repository";
import { CommunityDetectorService } from "../../community.detector/services/community.detector.service";

export interface MigrationResult {
  totalCompanies: number;
  processedCompanies: number;
  failedCompanies: string[];
  communitiesCreated: number;
}

@Injectable()
export class DriftMigrationService {
  constructor(
    private readonly logger: AppLoggingService,
    private readonly clsService: ClsService,
    private readonly moduleRef: ModuleRef,
    private readonly communityRepository: CommunityRepository,
    private readonly communityDetectorService: CommunityDetectorService,
  ) {}

  /**
   * The app's own CompanyRepository, resolved at call time.
   *
   * DriftModule must not provide a CompanyRepository of its own: every
   * repository instance runs `onModuleInit` and (re)creates
   * `company_search_index` from its descriptor. An app that replaces the
   * company foundation (e.g. with an extended descriptor) would then get two
   * repositories with different field sets rebuilding the same index on every
   * boot. Resolving the token globally reuses whichever repository the app
   * registered under `CompanyRepository`.
   */
  private get companyRepository(): CompanyRepository {
    return this.moduleRef.get(CompanyRepository, { strict: false });
  }

  /**
   * Run DRIFT migration for all companies
   * This detects communities for all existing KeyConcepts
   * The community summariser cron job will then generate summaries
   */
  async migrateAll(): Promise<MigrationResult> {
    this.logger.log("Starting DRIFT migration for all companies", "DriftMigrationService");

    const result: MigrationResult = {
      totalCompanies: 0,
      processedCompanies: 0,
      failedCompanies: [],
      communitiesCreated: 0,
    };

    const companies = await this.companyRepository.fetchAll();
    result.totalCompanies = companies.length;

    this.logger.log(`Found ${companies.length} companies to process`, "DriftMigrationService");

    for (const company of companies) {
      try {
        await this.migrateCompany(company.id);
        result.processedCompanies++;
        this.logger.log(`Processed company ${company.id} (${company.name})`, "DriftMigrationService");
      } catch (error) {
        result.failedCompanies.push(company.id);
        this.logger.error(
          `Failed to process company ${company.id}: ${(error as Error).message}`,
          "DriftMigrationService",
        );
      }
    }

    this.logger.log(
      `DRIFT migration completed: ${result.processedCompanies}/${result.totalCompanies} companies processed`,
      "DriftMigrationService",
    );

    return result;
  }

  /**
   * Run DRIFT migration for a specific company
   * Sets up CLS context and runs community detection
   */
  async migrateCompany(companyId: string): Promise<void> {
    await this.clsService.run(async () => {
      this.clsService.set("companyId", companyId);

      this.logger.debug(`Running community detection for company ${companyId}`, "DriftMigrationService");

      await this.communityDetectorService.detectCommunities();

      this.logger.debug(`Community detection completed for company ${companyId}`, "DriftMigrationService");
    });
  }

  /**
   * Get migration status - count stale vs processed communities per company
   */
  async getMigrationStatus(): Promise<{
    companies: {
      companyId: string;
      companyName: string;
      totalCommunities: number;
      staleCommunities: number;
      processedCommunities: number;
    }[];
  }> {
    const companies = await this.companyRepository.fetchAll();
    const status: {
      companyId: string;
      companyName: string;
      totalCommunities: number;
      staleCommunities: number;
      processedCommunities: number;
    }[] = [];

    for (const company of companies) {
      const counts = await this.getCommunityCountsForCompany(company.id);
      status.push({
        companyId: company.id,
        companyName: company.name,
        ...counts,
      });
    }

    return { companies: status };
  }

  /**
   * Get community counts for a specific company
   */
  private async getCommunityCountsForCompany(
    companyId: string,
  ): Promise<{ totalCommunities: number; staleCommunities: number; processedCommunities: number }> {
    return new Promise((resolve) => {
      this.clsService.run(async () => {
        this.clsService.set("companyId", companyId);

        const levelCounts = await this.communityRepository.countByLevel();
        const staleCount = await this.communityRepository.countStaleCommunities();

        const totalCommunities = (levelCounts ?? []).reduce((sum, lc) => sum + lc.count, 0);

        resolve({
          totalCommunities,
          staleCommunities: staleCount,
          processedCommunities: totalCommunities - staleCount,
        });
      });
    });
  }
}
