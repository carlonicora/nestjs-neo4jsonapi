/**
 * Company Service Unit Tests
 *
 * Tests the CompanyService class that handles business logic for Company operations.
 * These tests verify that the service works correctly before and after migration.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpException, HttpStatus } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { getQueueToken } from "@nestjs/bullmq";
import { ModuleRef } from "@nestjs/core";
import { ClsService } from "nestjs-cls";
import { Queue } from "bullmq";
import { CompanyService } from "./company.service";
import { CompanyRepository } from "../repositories/company.repository";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { VersionService } from "../../../core/version/services/version.service";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import { QueueId } from "../../../config/enums/queue.id";
import { Company } from "../entities/company";

describe("CompanyService", () => {
  let service: CompanyService;
  let mockRepository: vi.Mocked<CompanyRepository>;
  let mockJsonApiService: vi.Mocked<JsonApiService>;
  let mockQueue: vi.Mocked<Queue>;
  let mockClsService: vi.Mocked<ClsService>;
  let mockNeo4jService: vi.Mocked<Neo4jService>;
  let mockVersionService: vi.Mocked<VersionService>;
  let mockModuleRef: vi.Mocked<ModuleRef>;
  let mockWebSocketService: vi.Mocked<WebSocketService>;

  const MOCK_COMPANY_ID = "company-123";
  const MOCK_COMPANY: Company = {
    id: MOCK_COMPANY_ID,
    type: "companies",
    name: "Test Company",
    logo: "logos/test.png",
    logoUrl: "https://s3.amazonaws.com/logos/test.png",
    isActiveSubscription: true,
    ownerEmail: "owner@test.com",
    monthlyTokens: 10000,
    availableMonthlyTokens: 5000,
    availableExtraTokens: 2000,
    configurations: '{"setting": true}',
    feature: [],
    module: [],
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-06-15"),
  };

  beforeEach(async () => {
    mockRepository = {
      findByCompanyId: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateConfigurations: vi.fn(),
      find: vi.fn(),
      findSingle: vi.fn(),
      delete: vi.fn(),
      useTokens: vi.fn(),
    } as any;

    mockJsonApiService = {
      buildSingle: vi.fn(),
      buildList: vi.fn(),
    } as any;

    mockQueue = {
      add: vi.fn(),
    } as any;

    mockClsService = {
      get: vi.fn(),
      set: vi.fn(),
    } as any;

    mockNeo4jService = {} as any;
    mockVersionService = {} as any;
    mockModuleRef = {} as any;

    mockWebSocketService = {
      sendMessageToCompany: vi.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanyService,
        { provide: CompanyRepository, useValue: mockRepository },
        { provide: JsonApiService, useValue: mockJsonApiService },
        { provide: getQueueToken(QueueId.COMPANY), useValue: mockQueue },
        { provide: ClsService, useValue: mockClsService },
        { provide: Neo4jService, useValue: mockNeo4jService },
        { provide: VersionService, useValue: mockVersionService },
        { provide: ModuleRef, useValue: mockModuleRef },
        { provide: WebSocketService, useValue: mockWebSocketService },
      ],
    }).compile();

    service = module.get<CompanyService>(CompanyService);
  });

  describe("validate", () => {
    it("should not throw when company exists", async () => {
      mockRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);

      await expect(service.validate({ companyId: MOCK_COMPANY_ID })).resolves.not.toThrow();

      expect(mockRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: MOCK_COMPANY_ID,
      });
    });

    it("should throw HttpException when company not found", async () => {
      mockRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.validate({ companyId: "nonexistent" })).rejects.toThrow(
        new HttpException("Company not found", HttpStatus.UNAUTHORIZED),
      );
    });
  });

  describe("validateCompanyTokens", () => {
    it("should not throw when company has available monthly tokens", async () => {
      mockRepository.findByCompanyId.mockResolvedValue({
        ...MOCK_COMPANY,
        availableMonthlyTokens: 1000,
        availableExtraTokens: 0,
      });

      await expect(service.validateCompanyTokens({ companyId: MOCK_COMPANY_ID })).resolves.not.toThrow();
    });

    it("should not throw when company has available extra tokens", async () => {
      mockRepository.findByCompanyId.mockResolvedValue({
        ...MOCK_COMPANY,
        availableMonthlyTokens: 0,
        availableExtraTokens: 500,
      });

      await expect(service.validateCompanyTokens({ companyId: MOCK_COMPANY_ID })).resolves.not.toThrow();
    });

    it("should throw NO_TOKENS when no tokens available", async () => {
      mockRepository.findByCompanyId.mockResolvedValue({
        ...MOCK_COMPANY,
        availableMonthlyTokens: 0,
        availableExtraTokens: 0,
      });

      await expect(service.validateCompanyTokens({ companyId: MOCK_COMPANY_ID })).rejects.toThrow(
        new HttpException("NO_TOKENS", HttpStatus.PAYMENT_REQUIRED),
      );
    });

    it("should throw NO_TOKENS when tokens are negative", async () => {
      mockRepository.findByCompanyId.mockResolvedValue({
        ...MOCK_COMPANY,
        availableMonthlyTokens: -10,
        availableExtraTokens: -5,
      });

      await expect(service.validateCompanyTokens({ companyId: MOCK_COMPANY_ID })).rejects.toThrow(
        new HttpException("NO_TOKENS", HttpStatus.PAYMENT_REQUIRED),
      );
    });
  });

  describe("useTokens", () => {
    it("should call repository to use tokens", async () => {
      mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);
      mockRepository.useTokens.mockResolvedValue();

      await service.useTokens({ inputTokens: 100, outputTokens: 50 });

      expect(mockRepository.useTokens).toHaveBeenCalledWith({
        input: 100,
        output: 50,
      });
    });

    it("should broadcast token update via websocket", async () => {
      mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);
      mockRepository.useTokens.mockResolvedValue();

      await service.useTokens({ inputTokens: 100, outputTokens: 50 });

      expect(mockWebSocketService.sendMessageToCompany).toHaveBeenCalledWith(
        MOCK_COMPANY_ID,
        "company:tokens_updated",
        {
          type: "company:tokens_updated",
          companyId: MOCK_COMPANY_ID,
        },
      );
    });

    it("should not broadcast if companyId is not set", async () => {
      mockClsService.get.mockReturnValue(undefined);
      mockRepository.useTokens.mockResolvedValue();

      await service.useTokens({ inputTokens: 100, outputTokens: 50 });

      expect(mockWebSocketService.sendMessageToCompany).not.toHaveBeenCalled();
    });
  });

  describe("create", () => {
    it("should create a company with all parameters", async () => {
      const postData = {
        id: MOCK_COMPANY_ID,
        attributes: {
          name: "New Company",
          configurations: '{"key": "value"}',
          monthlyTokens: 5000,
          availableMonthlyTokens: 5000,
          availableExtraTokens: 1000,
        },
        relationships: {
          features: {
            data: [{ id: "feature-1", type: "features" }],
          },
        },
      };

      mockRepository.create.mockResolvedValue(MOCK_COMPANY);

      const result = await service.create({ data: postData as any });

      expect(mockRepository.create).toHaveBeenCalledWith({
        companyId: MOCK_COMPANY_ID,
        name: "New Company",
        configurations: '{"key": "value"}',
        monthlyTokens: 5000,
        availableMonthlyTokens: 5000,
        availableExtraTokens: 1000,
        featureIds: ["feature-1"],
      });
      expect(result).toEqual(MOCK_COMPANY);
    });

    it("should handle missing relationships", async () => {
      const postData = {
        id: MOCK_COMPANY_ID,
        attributes: {
          name: "Minimal Company",
        },
      };

      mockRepository.create.mockResolvedValue(MOCK_COMPANY);

      await service.create({ data: postData as any });

      expect(mockRepository.create).toHaveBeenCalledWith({
        companyId: MOCK_COMPANY_ID,
        name: "Minimal Company",
        configurations: undefined,
        monthlyTokens: undefined,
        availableMonthlyTokens: undefined,
        availableExtraTokens: undefined,
        featureIds: undefined,
      });
    });
  });

  describe("createForController", () => {
    it("should create company and return JSON:API response", async () => {
      const postData = {
        id: MOCK_COMPANY_ID,
        attributes: {
          name: "Controller Company",
          configurations: "",
          monthlyTokens: 1000,
          availableMonthlyTokens: 1000,
          availableExtraTokens: 0,
        },
        relationships: {
          features: { data: [] },
          modules: { data: [] },
        },
      };

      const mockJsonApiResponse = { type: "companies", id: MOCK_COMPANY_ID };
      mockRepository.create.mockResolvedValue(MOCK_COMPANY);
      mockRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
      mockJsonApiService.buildSingle.mockResolvedValue(mockJsonApiResponse);

      const result = await service.createForController({ data: postData as any });

      expect(mockRepository.create).toHaveBeenCalled();
      expect(mockRepository.findByCompanyId).toHaveBeenCalledWith({ companyId: MOCK_COMPANY_ID });
      expect(mockJsonApiService.buildSingle).toHaveBeenCalled();
      expect(result).toEqual(mockJsonApiResponse);
    });
  });

  describe("update", () => {
    it("should update company and return JSON:API response", async () => {
      const putData = {
        id: MOCK_COMPANY_ID,
        attributes: {
          name: "Updated Company",
          configurations: '{"updated": true}',
          logo: "logos/updated.png",
          monthlyTokens: 20000,
          availableMonthlyTokens: 15000,
          availableExtraTokens: 3000,
        },
        relationships: {
          features: { data: [{ id: "feature-2", type: "features" }] },
          modules: { data: [{ id: "module-1", type: "modules" }] },
        },
      };

      const mockJsonApiResponse = { type: "companies", id: MOCK_COMPANY_ID };
      mockRepository.update.mockResolvedValue();
      mockRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
      mockJsonApiService.buildSingle.mockResolvedValue(mockJsonApiResponse);

      const result = await service.update({ data: putData as any });

      expect(mockRepository.update).toHaveBeenCalledWith({
        companyId: MOCK_COMPANY_ID,
        name: "Updated Company",
        configurations: '{"updated": true}',
        logo: "logos/updated.png",
        monthlyTokens: 20000,
        availableMonthlyTokens: 15000,
        availableExtraTokens: 3000,
        featureIds: ["feature-2"],
        moduleIds: ["module-1"],
      });
      expect(result).toEqual(mockJsonApiResponse);
    });
  });

  describe("updateConfigurations", () => {
    it("should update only configurations and return JSON:API response", async () => {
      const configData = {
        id: MOCK_COMPANY_ID,
        attributes: {
          configurations: '{"new": "config"}',
        },
      };

      const mockJsonApiResponse = { type: "companies", id: MOCK_COMPANY_ID };
      mockRepository.updateConfigurations.mockResolvedValue();
      mockRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
      mockJsonApiService.buildSingle.mockResolvedValue(mockJsonApiResponse);

      const result = await service.updateConfigurations({ data: configData as any });

      expect(mockRepository.updateConfigurations).toHaveBeenCalledWith({
        companyId: MOCK_COMPANY_ID,
        configurations: '{"new": "config"}',
      });
      expect(result).toEqual(mockJsonApiResponse);
    });
  });

  describe("find", () => {
    it("should find companies with search term and pagination", async () => {
      const mockCompanies = [MOCK_COMPANY];
      const mockJsonApiResponse = { data: mockCompanies };
      mockRepository.find.mockResolvedValue(mockCompanies);
      mockJsonApiService.buildList.mockResolvedValue(mockJsonApiResponse);

      const result = await service.find({
        term: "test",
        query: { page: { number: 1, size: 10 } },
      });

      expect(mockRepository.find).toHaveBeenCalled();
      expect(mockJsonApiService.buildList).toHaveBeenCalled();
      expect(result).toEqual(mockJsonApiResponse);
    });

    it("should find companies without search term", async () => {
      const mockCompanies: Company[] = [];
      const mockJsonApiResponse = { data: [] };
      mockRepository.find.mockResolvedValue(mockCompanies);
      mockJsonApiService.buildList.mockResolvedValue(mockJsonApiResponse);

      const result = await service.find({
        query: {},
      });

      expect(mockRepository.find).toHaveBeenCalled();
      expect(result).toEqual(mockJsonApiResponse);
    });
  });

  describe("findOne", () => {
    it("should find a single company by ID", async () => {
      const mockJsonApiResponse = { type: "companies", id: MOCK_COMPANY_ID };
      mockRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
      mockJsonApiService.buildSingle.mockResolvedValue(mockJsonApiResponse);

      const result = await service.findOne({ companyId: MOCK_COMPANY_ID });

      expect(mockRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: MOCK_COMPANY_ID,
      });
      expect(mockJsonApiService.buildSingle).toHaveBeenCalled();
      expect(result).toEqual(mockJsonApiResponse);
    });
  });

  describe("findRaw", () => {
    it("should return raw company entity", async () => {
      mockRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);

      const result = await service.findRaw({ companyId: MOCK_COMPANY_ID });

      expect(mockRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: MOCK_COMPANY_ID,
      });
      expect(result).toEqual(MOCK_COMPANY);
    });
  });

  describe("delete", () => {
    it("should add delete job to queue", async () => {
      await service.delete({ companyId: MOCK_COMPANY_ID });

      expect(mockQueue.add).toHaveBeenCalledWith("deleteCompany", {
        companyId: MOCK_COMPANY_ID,
      });
    });
  });

  describe("deleteFullCompany", () => {
    it("should directly delete company via repository", async () => {
      mockRepository.delete.mockResolvedValue();

      await service.deleteFullCompany({ companyId: MOCK_COMPANY_ID });

      expect(mockRepository.delete).toHaveBeenCalledWith({
        companyId: MOCK_COMPANY_ID,
      });
    });
  });

  describe("deleteImmediate", () => {
    it("should fall back to repository delete when no deletion handler is provided", async () => {
      mockRepository.delete.mockResolvedValue();

      await service.deleteImmediate({ companyId: MOCK_COMPANY_ID });

      expect(mockRepository.delete).toHaveBeenCalledWith({
        companyId: MOCK_COMPANY_ID,
      });
    });

    it("should use provided company name when available", async () => {
      mockRepository.delete.mockResolvedValue();

      await service.deleteImmediate({ companyId: MOCK_COMPANY_ID, companyName: "Test Company" });

      expect(mockRepository.delete).toHaveBeenCalledWith({
        companyId: MOCK_COMPANY_ID,
      });
    });
  });

  describe("setDefaultCompanyRequestConfigurationForContactRequests", () => {
    it("should not modify CLS when companyId is already set", async () => {
      mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);

      await service.setDefaultCompanyRequestConfigurationForContactRequests();

      expect(mockRepository.findSingle).not.toHaveBeenCalled();
      expect(mockClsService.set).not.toHaveBeenCalled();
    });

    it("should set companyId in CLS when not set and company exists", async () => {
      mockClsService.get.mockReturnValue(undefined);
      mockRepository.findSingle.mockResolvedValue(MOCK_COMPANY);

      await service.setDefaultCompanyRequestConfigurationForContactRequests();

      expect(mockRepository.findSingle).toHaveBeenCalled();
      expect(mockClsService.set).toHaveBeenCalledWith("companyId", MOCK_COMPANY_ID);
    });

    it("should throw Forbidden when no company exists", async () => {
      mockClsService.get.mockReturnValue(undefined);
      mockRepository.findSingle.mockResolvedValue(null);

      await expect(service.setDefaultCompanyRequestConfigurationForContactRequests()).rejects.toThrow(
        new HttpException("Forbidden", HttpStatus.FORBIDDEN),
      );
    });
  });
});
