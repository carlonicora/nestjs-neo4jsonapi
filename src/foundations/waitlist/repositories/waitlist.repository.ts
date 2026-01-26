import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { Waitlist, WaitlistDescriptor, WaitlistStatus } from "../entities/waitlist";

@Injectable()
export class WaitlistRepository extends AbstractRepository<Waitlist, typeof WaitlistDescriptor.relationships> {
  protected readonly descriptor = WaitlistDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  // Inherited methods from AbstractRepository:
  // - find(params): Promise<T[]> - paginated list with cursor
  // - findById(params: { id: string }): Promise<T | null>
  // - create(params: { id: string; [key: string]: any }): Promise<void>
  // - put(params): Promise<void>
  // - patch(params): Promise<void>
  // - delete(params: { id: string }): Promise<void>
  // - onModuleInit() - creates constraints and indexes

  /**
   * Find a waitlist entry by email address.
   */
  async findByEmail(params: { email: string }): Promise<Waitlist | null> {
    const { nodeName, labelName } = this.descriptor.model;
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });

    query.queryParams = {
      email: params.email.toLowerCase(),
    };

    query.query = `
      MATCH (${nodeName}:${labelName})
      WHERE toLower(${nodeName}.email) = $email
      RETURN ${nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Find a waitlist entry by confirmation code.
   */
  async findByConfirmationCode(params: { code: string }): Promise<Waitlist | null> {
    const { nodeName, labelName } = this.descriptor.model;
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });

    query.queryParams = {
      code: params.code,
    };

    query.query = `
      MATCH (${nodeName}:${labelName} {confirmationCode: $code})
      RETURN ${nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Find a waitlist entry by invite code.
   */
  async findByInviteCode(params: { code: string }): Promise<Waitlist | null> {
    console.log("[WaitlistRepository.findByInviteCode] Querying for code:", params.code);

    const { nodeName, labelName } = this.descriptor.model;
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });

    query.queryParams = {
      code: params.code,
    };

    query.query = `
      MATCH (${nodeName}:${labelName} {inviteCode: $code})
      RETURN ${nodeName}
    `;

    const result = await this.neo4j.readOne(query);
    console.log("[WaitlistRepository.findByInviteCode] Query result:", result ? `Found id=${result.id}` : "Not found");

    return result;
  }

  /**
   * Find all waitlist entries with optional status filter.
   * Uses cursor-based pagination.
   */
  async findAllByStatus(params: { status?: WaitlistStatus; cursor?: JsonApiCursorInterface }): Promise<Waitlist[]> {
    const { nodeName, labelName } = this.descriptor.model;
    const query = this.neo4j.initQuery({
      serialiser: this.descriptor.model,
      cursor: params.cursor,
    });

    const statusFilter = params.status ? `WHERE ${nodeName}.status = $status` : "";

    query.queryParams = {
      ...query.queryParams,
      status: params.status ?? null,
    };

    query.query = `
      MATCH (${nodeName}:${labelName})
      ${statusFilter}
      ORDER BY ${nodeName}.createdAt DESC
      {CURSOR}
      RETURN ${nodeName}
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Update the status of a waitlist entry.
   */
  async updateStatus(params: { id: string; status: WaitlistStatus; confirmedAt?: Date }): Promise<void> {
    const { nodeName, labelName } = this.descriptor.model;
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });

    const confirmedAtClause = params.confirmedAt ? `, ${nodeName}.confirmedAt = datetime($confirmedAt)` : "";

    query.queryParams = {
      id: params.id,
      status: params.status,
      confirmedAt: params.confirmedAt?.toISOString() ?? null,
    };

    query.query = `
      MATCH (${nodeName}:${labelName} {id: $id})
      SET ${nodeName}.status = $status,
          ${nodeName}.updatedAt = datetime()
          ${confirmedAtClause}
      RETURN ${nodeName}
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Set the invite code for a waitlist entry.
   */
  async setInviteCode(params: {
    id: string;
    inviteCode: string;
    inviteCodeExpiration: Date;
    invitedAt: Date;
  }): Promise<void> {
    const { nodeName, labelName } = this.descriptor.model;
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });

    query.queryParams = {
      id: params.id,
      inviteCode: params.inviteCode,
      inviteCodeExpiration: params.inviteCodeExpiration.toISOString(),
      invitedAt: params.invitedAt.toISOString(),
      status: WaitlistStatus.Invited,
    };

    query.query = `
      MATCH (${nodeName}:${labelName} {id: $id})
      SET ${nodeName}.inviteCode = $inviteCode,
          ${nodeName}.inviteCodeExpiration = datetime($inviteCodeExpiration),
          ${nodeName}.invitedAt = datetime($invitedAt),
          ${nodeName}.status = $status,
          ${nodeName}.updatedAt = datetime()
      RETURN ${nodeName}
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Mark a waitlist entry as registered (user created account).
   */
  async markAsRegistered(params: { id: string; userId: string; registeredAt: Date }): Promise<void> {
    const { nodeName, labelName } = this.descriptor.model;
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });

    query.queryParams = {
      id: params.id,
      userId: params.userId,
      registeredAt: params.registeredAt.toISOString(),
      status: WaitlistStatus.Registered,
    };

    query.query = `
      MATCH (${nodeName}:${labelName} {id: $id})
      SET ${nodeName}.userId = $userId,
          ${nodeName}.registeredAt = datetime($registeredAt),
          ${nodeName}.status = $status,
          ${nodeName}.updatedAt = datetime()
      RETURN ${nodeName}
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Get statistics about waitlist entries by status.
   */
  async getStats(): Promise<{
    pending: number;
    confirmed: number;
    invited: number;
    registered: number;
    total: number;
  }> {
    const { labelName } = this.descriptor.model;
    const query = `
      MATCH (w:${labelName})
      RETURN w.status as status, count(*) as count
    `;

    const result = await this.neo4j.read(query, {});
    const stats = { pending: 0, confirmed: 0, invited: 0, registered: 0, total: 0 };

    for (const record of result.records) {
      const status = record.get("status") as WaitlistStatus;
      const count = record.get("count").toNumber();
      stats[status] = count;
      stats.total += count;
    }

    return stats;
  }
}
