import { beforeEach, describe, expect, it, vi } from "vitest";
import { WriteAudit } from "../write-audit.decorator";

describe("WriteAudit", () => {
  const mockMeta = {
    type: "warehouses",
    endpoint: "warehouses",
    nodeName: "warehouse",
    labelName: "Warehouse",
  };

  let mockAuditService: { createWriteAuditEntry: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockAuditService = {
      createWriteAuditEntry: vi.fn(),
    };
  });

  describe("Scenario: Create audit entry for POST operations", () => {
    it("should call createWriteAuditEntry with auditType 'create' and changes from body", async () => {
      class TestController {
        auditService = mockAuditService;

        @WriteAudit(mockMeta, "create")
        async create(..._args: any[]) {
          return { data: { id: "new-entity-id" } };
        }
      }

      const controller = new TestController();
      const body = {
        data: {
          id: "new-entity-id",
          type: "warehouses",
          attributes: { name: "Test" },
        },
      };

      const result = await controller.create(body);

      expect(result).toEqual({ data: { id: "new-entity-id" } });
      expect(mockAuditService.createWriteAuditEntry).toHaveBeenCalledWith({
        entityType: "Warehouse",
        entityId: "new-entity-id",
        auditType: "create",
        changes: JSON.stringify({
          attributes: { name: "Test" },
        }),
      });
    });
  });

  describe("Scenario: Create audit entry for PUT operations", () => {
    it("should call createWriteAuditEntry with auditType 'edit' and changes from body", async () => {
      class TestController {
        auditService = mockAuditService;

        @WriteAudit(mockMeta, "edit")
        async update(..._args: any[]) {
          return { data: { id: "entity-id" } };
        }
      }

      const controller = new TestController();
      const body = {
        data: {
          id: "entity-id",
          type: "warehouses",
          attributes: { name: "Updated" },
        },
      };

      const result = await controller.update(body);

      expect(result).toEqual({ data: { id: "entity-id" } });
      expect(mockAuditService.createWriteAuditEntry).toHaveBeenCalledWith({
        entityType: "Warehouse",
        entityId: "entity-id",
        auditType: "edit",
        changes: JSON.stringify({
          attributes: { name: "Updated" },
        }),
      });
    });
  });

  describe("Scenario: Decorator captures body attributes and relationships", () => {
    it("should include both attributes and relationships in changes", async () => {
      class TestController {
        auditService = mockAuditService;

        @WriteAudit(mockMeta, "edit")
        async update(..._args: any[]) {
          return { data: { id: "entity-id" } };
        }
      }

      const controller = new TestController();
      const body = {
        data: {
          id: "entity-id",
          type: "warehouses",
          attributes: { name: "Updated Warehouse" },
          relationships: {
            locations: { data: [{ type: "locations", id: "loc-1" }] },
          },
        },
      };

      await controller.update(body);

      expect(mockAuditService.createWriteAuditEntry).toHaveBeenCalledWith({
        entityType: "Warehouse",
        entityId: "entity-id",
        auditType: "edit",
        changes: JSON.stringify({
          attributes: { name: "Updated Warehouse" },
          relationships: {
            locations: { data: [{ type: "locations", id: "loc-1" }] },
          },
        }),
      });
    });
  });

  describe("Scenario: Missing auditService is handled gracefully", () => {
    it("should not throw when auditService is not available", async () => {
      class TestController {
        auditService = undefined;

        @WriteAudit(mockMeta, "create")
        async create(..._args: any[]) {
          return { data: { id: "entity-id" } };
        }
      }

      const controller = new TestController();
      const body = { data: { id: "entity-id", type: "warehouses" } };

      const result = await controller.create(body);

      expect(result).toEqual({ data: { id: "entity-id" } });
    });
  });

  describe("Scenario: Sensitive fields are redacted from changes", () => {
    it("should replace sensitive attribute values with [REDACTED]", async () => {
      class TestController {
        auditService = mockAuditService;

        @WriteAudit(mockMeta, "create")
        async create(..._args: any[]) {
          return { data: { id: "entity-id" } };
        }
      }

      const controller = new TestController();
      const body = {
        data: {
          id: "entity-id",
          type: "warehouses",
          attributes: { name: "Test", password: "secret123", apiKey: "key-abc" },
        },
      };

      await controller.create(body);

      expect(mockAuditService.createWriteAuditEntry).toHaveBeenCalledWith({
        entityType: "Warehouse",
        entityId: "entity-id",
        auditType: "create",
        changes: JSON.stringify({
          attributes: { name: "Test", password: "[REDACTED]", apiKey: "[REDACTED]" },
        }),
      });
    });
  });

  describe("Scenario: Missing entity ID is handled gracefully", () => {
    it("should not call auditService when body has no data.id", async () => {
      class TestController {
        auditService = mockAuditService;

        @WriteAudit(mockMeta, "create")
        async create(..._args: any[]) {
          return { data: {} };
        }
      }

      const controller = new TestController();
      const body = { attributes: { name: "Test" } };

      await controller.create(body);

      expect(mockAuditService.createWriteAuditEntry).not.toHaveBeenCalled();
    });
  });
});
