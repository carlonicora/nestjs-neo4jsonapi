import { InjectQueue } from "@nestjs/bullmq";
import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import axios from "axios";
import { Queue } from "bullmq";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { ClsService } from "nestjs-cls";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { VersionService } from "../../../core/version/services/version.service";
import { CompanyLicensePutDataDTO } from "../../company/dtos/company.license.put.dto";
import { CompanyPostDataDTO } from "../../company/dtos/company.post.dto";
import { CompanyPutDataDTO } from "../../company/dtos/company.put.dto";
import { Company } from "../../company/entities/company.entity";
import { CompanyModel } from "../../company/entities/company.model";
import { CompanyRepository } from "../../company/repositories/company.repository";

const LICENSE_SERVICE_URL = "http://localhost:3300/licenses/:installationId/validate";

@Injectable()
export class CompanyService {
  constructor(
    private readonly builder: JsonApiService,
    private readonly companyRepository: CompanyRepository,
    @InjectQueue(`${process.env.QUEUE}_company`) private readonly queue: Queue,
    private readonly cls: ClsService,
    private readonly neo4j: Neo4jService,
    private readonly versionService: VersionService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async validate(params: { companyId: string }) {
    const company = await this.companyRepository.findByCompanyId({
      companyId: params.companyId,
    });

    if (!company) throw new HttpException("Company not found", HttpStatus.UNAUTHORIZED);
  }

  async validateCompanyTokens(params: { companyId: string }) {
    const company = await this.companyRepository.findByCompanyId({
      companyId: params.companyId,
    });

    if (!company.availableTokens || company.availableTokens <= 0)
      throw new HttpException("NO_TOKENS", HttpStatus.PAYMENT_REQUIRED);
  }

  async useTokens(params: { inputTokens: number; outputTokens: number }) {
    await this.companyRepository.useTokens({
      input: params.inputTokens,
      output: params.outputTokens,
    });
  }

  async create(params: { data: CompanyPostDataDTO }): Promise<Company> {
    return this.companyRepository.create({
      companyId: params.data.id,
      name: params.data.attributes.name,
      configurations: params.data.attributes.configurations,
      availableTokens: params.data.attributes.availableTokens,
      featureIds: params.data.relationships?.features?.data.map((feature) => feature.id),
    });
  }

  async createForController(params: { data: CompanyPostDataDTO }): Promise<JsonApiDataInterface> {
    await this.companyRepository.create({
      companyId: params.data.id,
      name: params.data.attributes.name,
      configurations: params.data.attributes.configurations,
      availableTokens: params.data.attributes.availableTokens,
      featureIds: params.data.relationships?.features?.data.map((feature) => feature.id),
      moduleIds: params.data.relationships?.modules?.data.map((module) => module.id),
    });

    return this.builder.buildSingle(
      CompanyModel,
      await this.companyRepository.findByCompanyId({ companyId: params.data.id }),
    );
  }

  async update(params: { data: CompanyPutDataDTO }): Promise<JsonApiDataInterface> {
    await this.companyRepository.update({
      companyId: params.data.id,
      name: params.data.attributes.name,
      configurations: params.data.attributes.configurations,
      logo: params.data.attributes.logo,
      availableTokens: params.data.attributes.availableTokens,
      featureIds: params.data.relationships?.features?.data.map((feature) => feature.id),
      moduleIds: params.data.relationships?.modules?.data.map((module) => module.id),
    });

    return this.builder.buildSingle(
      CompanyModel,
      await this.companyRepository.findByCompanyId({ companyId: params.data.id }),
    );
  }

  async find(params: { term?: string; query: any }): Promise<JsonApiDataInterface> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.builder.buildList(
      CompanyModel,
      await this.companyRepository.find({ term: params.term, cursor: paginator.generateCursor() }),
      paginator,
    );
  }

  async findOne(params: { companyId: string }): Promise<JsonApiDataInterface> {
    return this.builder.buildSingle(
      CompanyModel,
      await this.companyRepository.findByCompanyId({ companyId: params.companyId }),
    );
  }

  async delete(params: { companyId: string }): Promise<void> {
    const queueElement: any = {
      companyId: params.companyId,
    };
    await this.queue.add("deleteCompany", queueElement);
  }

  async deleteFullCompany(params: { companyId: string }): Promise<void> {
    await this.companyRepository.delete({ companyId: params.companyId });
  }

  async setDefaultCompanyRequestConfigurationForContactRequests(): Promise<void> {
    const companyId = this.cls.get("companyId");

    if (!companyId) {
      const company = await this.companyRepository.findSingle();
      if (!company) throw new HttpException(`Forbidden`, HttpStatus.FORBIDDEN);
      this.cls.set("companyId", company.id);
    }
  }

  // async validateLicense(params: { companyId: string }): Promise<void> {
  //   const company = await this.companyRepository.findByCompanyId({ companyId: params.companyId });
  //   const licenseData = {
  //     isFirstActivation: true,
  //     license: company.license,
  //     installationIdentifier: params.companyId,
  //     version: this.versionService.getVersion(),
  //   };
  // }

  async activateLicense(params: { companyId: string; data: CompanyLicensePutDataDTO }) {
    const userCount = await this.companyRepository.countCompanyUsers({ companyId: params.companyId });

    const licenseData = {
      isFirstActivation: true,
      license: params.data.attributes.license,
      installationIdentifier: params.companyId,
      version: this.versionService.getVersion(),
      featureIds: [],
      userCount: userCount,
    };

    const licenseValidationResponse = await this._sendLicenseValidationRequest({
      companyId: params.companyId,
      licenseData: licenseData,
      privateKey: params.data.attributes.privateKey,
    });

    await this.companyRepository.updateLicense({
      companyId: params.companyId,
      license: licenseValidationResponse.license,
      licenseExpirationDate: new Date(licenseValidationResponse.expirationDate).toISOString(),
      licenseLastValidation: new Date().toISOString(),
    });

    return this.findOne({ companyId: params.companyId });
  }

  private async _sendLicenseValidationRequest(params: {
    companyId: string;
    licenseData: any;
    privateKey: string;
  }): Promise<{
    installationIdentifier: string;
    license: string;
    featureIds: string[];
    expirationDate: string;
  }> {
    try {
      const licenseJson = JSON.stringify(params.licenseData);
      const aesKey = createHash("sha256").update(params.privateKey, "utf8").digest();

      const iv = randomBytes(16);
      const cipher = createCipheriv("aes-256-cbc", aesKey, iv);
      let encrypted = cipher.update(licenseJson, "utf8", "hex");
      encrypted += cipher.final("hex");

      const payload = iv.toString("hex") + ":" + encrypted;

      const requestBody = {
        data: {
          id: params.companyId,
          type: "licenses",
          attributes: {
            payload: payload,
          },
        },
      };

      const response = await axios.post(LICENSE_SERVICE_URL.replace(":installationId", params.companyId), requestBody, {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      const [ivHex, encryptedData] = response.data.split(":");
      const decryptionIv = Buffer.from(ivHex, "hex");

      const decryptionAesKey = createHash("sha256").update(params.privateKey, "utf8").digest();

      const decipher = createDecipheriv("aes-256-cbc", decryptionAesKey, decryptionIv);
      let decrypted = decipher.update(encryptedData, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return JSON.parse(decrypted);
    } catch (error) {
      console.error("Error during license validation:", error);
      throw new HttpException(`License validation failed`, HttpStatus.PRECONDITION_FAILED);
    }
  }
}
