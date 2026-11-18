import { Injectable, NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { CompanyRepository } from "../../company/repositories/company.repository";

/**
 * Runs the company skill rules for the platform Administrator on the company named in the URL
 * (decision D15 / P11). The Administrator belongs to no company, so the request's CLS holds no
 * company and initQuery() would bind none; with the picked company set and the Administrator's
 * user id still present, initQuery() would add the membership match
 * `(currentUser)-[:BELONGS_TO]->(company)`, which matches nothing for the Administrator.
 *
 * `inCompany` therefore reads the Company first (404 on a miss), then runs the callback in a
 * nested CLS context, a shallow copy of the request's, holding the picked company and no user
 * id. initQuery(), buildDefaultMatch() and every guard stay as they are; the request's own
 * context (roles, user id) is untouched and comes back once the callback ends. Reached only
 * from SkillCompanyAdminController, whose routes are `@Roles(SystemRoles.Administrator)`.
 */
@Injectable()
export class SkillCompanyAdminService {
  constructor(
    private readonly clsService: ClsService,
    private readonly companyRepository: CompanyRepository,
  ) {}

  async inCompany<T>(params: { companyId: string; run: () => Promise<T> }): Promise<T> {
    const company = await this.companyRepository.findByCompanyId({ companyId: params.companyId });
    if (!company) throw new NotFoundException("not found");

    return this.clsService.run({ ifNested: "inherit" }, async () => {
      this.clsService.set("companyId", company.id);
      this.clsService.set("userId", null);
      return params.run();
    });
  }
}
