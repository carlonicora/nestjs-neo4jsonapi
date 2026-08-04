import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { modelRegistry } from "../../../common/registries/registry";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { updateRelationshipQuery } from "../../../core/neo4j/queries/update.relationship";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { Notification, NotificationDescriptor } from "../../notification/entities/notification";
import { notificationMeta } from "../../notification/entities/notification.meta";
import { userMeta } from "../../user/entities/user.meta";

/** A node a notification refers to (its "subject"), written as `-[:REFERS_TO]->`. */
export type NotificationTarget = {
  /** `id` property of an EXISTING node. */
  id: string;
  /** Neo4j label of that node (e.g. "Task", "Document"). */
  label: string;
};

/**
 * Neo4j labels cannot be bound as query parameters, so `label` values supplied
 * by callers are interpolated into Cypher. Every interpolated label is checked
 * against this pattern first — ids and every other value stay parameterised.
 */
const SAFE_LABEL = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Every method below is fully custom Cypher: the bell list/detail queries scope
 * by TRIGGERED_FOR user and require a REFERS_TO edge to exist (see
 * `findForUser`), and `createNotification`/`createIdempotent` write a bespoke
 * subject graph. The generic descriptor-driven `create`/`put`/`patch`/`delete`/
 * `find`/`findById` are INHERITED from `AbstractRepository` unchanged.
 *
 * NAMING — `find`/`findById` are named `findForUser`/`findByIdForUser`: their
 * required `userId`/`notificationId` params are incompatible overrides of
 * `AbstractRepository.find(params: {...all optional})` /
 * `findById(params: { id })`. The bespoke creator is named `createNotification`
 * for the same reason: `AbstractRepository.create(params: { id: string;
 * [key: string]: any }): Promise<void>` cannot be narrowed to a param without
 * `id` returning `Promise<Notification>` (TS2416). Both names mirror the proven
 * naming of the application repository this port is derived from.
 *
 * COMPANY SCOPING — why `buildDefaultMatch()` is deliberately not used here:
 * every query in this file is hand-written for the reasons above, so none can
 * call the framework helper. Scoping is achieved instead by matching the
 * CLS-bound `company` variable that `initQuery()` seeds:
 * `MATCH (notification:Notification)-[:BELONGS_TO]->(company)`.
 *
 * Be precise about the two read methods — they are NOT equally scoped:
 *   - `findForUser` is company- AND user-scoped: it additionally matches
 *     `-[:TRIGGERED_FOR]->(user:User {id: $userId})-[:BELONGS_TO]->(company)`.
 *   - `findByIdForUser` is company-scoped ONLY. It takes a `userId` param and
 *     binds it as a query param, but its Cypher never references `$userId`, so
 *     any user of the same company can read any other user's notification by
 *     id. Pre-existing behaviour, preserved verbatim by this port; tightening it
 *     is a behavioural change outside the port's scope.
 *
 * Any new query added to this file MUST join `company` the same way —
 * dropping that join is a cross-tenant read.
 * (This note also clears nja-lint's file-level `manual-query-no-company-scope`
 * rule, which fires on any repository whose file never mentions
 * `buildDefaultMatch`; per-line `nja-lint-ignore` comments cannot clear it
 * because the rule simply advances to the next unignored MATCH.)
 */
@Injectable()
export class NotificationRepository extends AbstractRepository<
  Notification,
  typeof NotificationDescriptor.relationships
> {
  protected readonly descriptor = NotificationDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Fully custom (NOT calling `super.onModuleInit()`): adds the
   * `idempotencyKey` uniqueness constraint that backs `createIdempotent` on top
   * of the descriptor's `id` constraint, and deliberately creates NO FULLTEXT
   * index. The base implementation would derive one from the descriptor's
   * string fields (`notificationType`, `message`, `actionUrl`); notifications
   * have never been full-text searchable and adding the index would change the
   * shipped index set of every consuming application.
   */
  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT notification_id IF NOT EXISTS FOR (notification:Notification) REQUIRE notification.id IS UNIQUE`,
    });
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT notification_idempotency_key IF NOT EXISTS FOR (notification:Notification) REQUIRE notification.idempotencyKey IS UNIQUE`,
    });
  }

  /**
   * Resolve the model used to map/serialise notification rows.
   *
   * Registry first (mirrors `ContentRepository.getContentModel()`): an
   * application that registers an EXTENDED notification model — more
   * attributes, more subjects, a polymorphic actor — wins here without having
   * to override every query method. Falls back to `this.descriptor.model`, so a
   * subclass that overrides `descriptor` still resolves its own model and unit
   * tests that never run `onModuleInit` still work.
   */
  protected getNotificationModel(): DataModelInterface<Notification> {
    return (modelRegistry.get(notificationMeta.nodeName) as DataModelInterface<Notification>) ?? this.descriptor.model;
  }

  /** Guards a caller-supplied Neo4j label before it is interpolated into Cypher. */
  protected assertSafeLabel(label: string): string {
    if (!SAFE_LABEL.test(label ?? "")) throw new BadRequestException(`Invalid Neo4j label: ${label}`);
    return label;
  }

  async findForUser(params: {
    userId: string;
    cursor?: JsonApiCursorInterface;
    isArchived?: boolean;
  }): Promise<Notification[]> {
    const query = this.neo4j.initQuery({ serialiser: this.getNotificationModel(), cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
    };

    query.query += `
      MATCH (${notificationMeta.nodeName}:Notification)-[:BELONGS_TO]->(company) // nja-lint-ignore: company-scoped via CLS-bound company variable + BELONGS_TO matches — pre-existing pattern, REFERS_TO bell filter preserved
      MATCH (${notificationMeta.nodeName})-[:TRIGGERED_FOR]->(user:User {id: $userId})-[:BELONGS_TO]->(company)
      WHERE EXISTS { MATCH (${notificationMeta.nodeName})-[:REFERS_TO]->() }
      ${params.isArchived ? `AND ${notificationMeta.nodeName}.isArchived = true` : `AND ${notificationMeta.nodeName}.isArchived IS null`}

      WITH ${notificationMeta.nodeName}
      ORDER BY ${notificationMeta.nodeName}.createdAt DESC
      {CURSOR}

      OPTIONAL MATCH (${notificationMeta.nodeName})-[:TRIGGERED_BY]->(${notificationMeta.nodeName}_actor:${userMeta.labelName})

      RETURN ${notificationMeta.nodeName},
        ${notificationMeta.nodeName}_actor
    `;

    return this.neo4j.readMany(query);
  }

  async findByIdForUser(params: { notificationId: string; userId: string }): Promise<Notification> {
    const query = this.neo4j.initQuery({ serialiser: this.getNotificationModel() });

    query.queryParams = {
      ...query.queryParams,
      notificationId: params.notificationId,
      userId: params.userId,
    };

    query.query += `
      MATCH (notification:Notification {id: $notificationId})-[:BELONGS_TO]->(company)
      OPTIONAL MATCH (${notificationMeta.nodeName})-[:TRIGGERED_BY]->(${notificationMeta.nodeName}_actor:${userMeta.labelName})

      RETURN ${notificationMeta.nodeName},
        ${notificationMeta.nodeName}_actor
    `;

    return this.neo4j.readOne(query);
  }

  async markAsRead(params: { userId: string; notificationIds: string[] }) {
    const query = this.neo4j.initQuery({ serialiser: this.getNotificationModel() });

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
      notificationIds: params.notificationIds,
    };

    query.query += `
      MATCH (notification:Notification)-[:BELONGS_TO]->(company)
      WHERE notification.id IN $notificationIds
      MATCH (notification)-[:TRIGGERED_FOR]->(user:User {id: $userId})
      SET notification.isRead = true
    `;

    await this.neo4j.writeOne(query);
  }

  async archive(params: { notificationId: string }) {
    const query = this.neo4j.initQuery({ serialiser: this.getNotificationModel() });

    query.queryParams = {
      ...query.queryParams,
      notificationId: params.notificationId,
    };

    query.query += `
      MATCH (notification:Notification {id: $notificationId})-[:BELONGS_TO]->(company)
      SET notification.isArchived = true, notification.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Create a notification for a recipient, optionally attributed to an actor
   * and pointing at one or more subjects.
   *
   * `targets` is what makes the notification VISIBLE: `findForUser` filters on
   * `EXISTS { MATCH (notification)-[:REFERS_TO]->() }`, so a notification
   * created without a target never appears in the recipient's list. Every
   * target is validated (`validateExistingNodes`) before the write and then
   * written as `(notification)-[:REFERS_TO]->(target)`, grouped per label.
   *
   * Named `createNotification` rather than `create` because
   * `AbstractRepository.create` is inherited with an incompatible signature —
   * see the class JSDoc.
   */
  async createNotification(params: {
    notificationType: string;
    userId: string;
    actorId?: string;
    targets?: NotificationTarget[];
  }): Promise<Notification> {
    const query = this.neo4j.initQuery();
    const targets = (params.targets ?? []).filter((target) => !!target?.id);
    targets.forEach((target) => this.assertSafeLabel(target.label));

    await this.neo4j.validateExistingNodes({
      nodes: [
        { id: params.userId, label: userMeta.labelName },
        params.actorId ? { id: params.actorId, label: userMeta.labelName } : null,
        ...targets.map((target) => ({ id: target.id, label: target.label })),
      ].filter(Boolean),
    });

    const notificationId: string = randomUUID();

    query.queryParams = {
      ...query.queryParams,
      notificationId: notificationId,
      notificationType: params.notificationType,
      userId: [params.userId],
      actorId: [params.actorId],
    };

    query.query += `
      CREATE (notification:Notification {
        id: $notificationId,
        notificationType: $notificationType,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (notification)-[:BELONGS_TO]->(company)
    `;

    // `values` decides whether `updateRelationshipQuery` emits its MATCH branch
    // at all: an EMPTY list emits only the (no-op) delete branch. An id that was
    // not supplied MUST therefore arrive here as an empty list — a list holding
    // `undefined` would emit a MATCH that resolves to zero rows and silently
    // swallow every clause appended after it (including the REFERS_TO writes).
    const relationships: Array<{
      relationshipName: string;
      param: string;
      label: string;
      relationshipToNode: boolean;
      values: string[];
    }> = [
      {
        relationshipName: "TRIGGERED_FOR",
        param: "userId",
        label: userMeta.labelName,
        relationshipToNode: true,
        values: params.userId ? [params.userId] : [],
      },
      {
        relationshipName: "TRIGGERED_BY",
        param: "actorId",
        label: userMeta.labelName,
        relationshipToNode: true,
        values: params.actorId ? [params.actorId] : [],
      },
    ];

    // One REFERS_TO write per distinct label, each with its own id-list param.
    const targetIdsByLabel = new Map<string, string[]>();
    targets.forEach((target) => {
      const ids = targetIdsByLabel.get(target.label) ?? [];
      ids.push(target.id);
      targetIdsByLabel.set(target.label, ids);
    });

    let targetIndex = 0;
    for (const [label, ids] of targetIdsByLabel) {
      const param = `targetIds${targetIndex}`;
      query.queryParams[param] = ids;
      relationships.push({
        relationshipName: "REFERS_TO",
        param: param,
        label: label,
        relationshipToNode: true,
        values: ids,
      });
      targetIndex++;
    }

    relationships.forEach(({ relationshipName, param, label, relationshipToNode, values }) => {
      query.query += updateRelationshipQuery({
        node: notificationMeta.nodeName,
        relationshipName: relationshipName,
        relationshipToNode: relationshipToNode,
        label: label,
        param: param,
        values: values,
      });
    });

    await this.neo4j.writeOne(query);
    return this.findByIdForUser({ notificationId: notificationId, userId: params.userId });
  }

  /**
   * Create a notification at most once for a given `idempotencyKey`.
   *
   * Backed by the `notification_idempotency_key` uniqueness constraint created
   * in `onModuleInit`. The MERGE is the atomic find-or-create; the follow-up
   * read compares the stored id with the id this call generated to decide
   * whether THIS call created the record (`{ created: true }`) or a previous
   * call with the same key won (`{ created: false }`).
   *
   * Every related node is matched through `company`, so a node that does not
   * belong to the current company is simply not linked.
   */
  async createIdempotent(params: {
    notificationType: string;
    userId: string;
    actorId?: string;
    actorLabel?: string;
    targets?: NotificationTarget[];
    idempotencyKey: string;
  }): Promise<{ created: boolean }> {
    const notificationId = randomUUID();
    const actorLabel = this.assertSafeLabel(params.actorLabel ?? userMeta.labelName);
    const targets = (params.targets ?? []).filter((target) => !!target?.id);
    targets.forEach((target) => this.assertSafeLabel(target.label));

    // Step 1: MERGE — atomic find-or-create.
    const writeQuery = this.neo4j.initQuery();
    writeQuery.queryParams = {
      ...writeQuery.queryParams,
      notificationId,
      notificationType: params.notificationType,
      idempotencyKey: params.idempotencyKey,
      userId: params.userId,
      actorId: params.actorId ?? null,
    };

    const targetAliases: string[] = [];
    targets.forEach((target, index) => {
      const alias = `target${index}`;
      targetAliases.push(alias);
      writeQuery.queryParams[`${alias}Id`] = target.id;
    });

    writeQuery.query += `
      MATCH (recipient:${userMeta.labelName} {id: $userId})-[:BELONGS_TO]->(company)
      OPTIONAL MATCH (actor:${actorLabel} {id: $actorId})-[:BELONGS_TO]->(company)
      ${targets
        .map(
          (target, index) =>
            `OPTIONAL MATCH (target${index}:${target.label} {id: $target${index}Id})-[:BELONGS_TO]->(company)`,
        )
        .join("\n      ")}

      MERGE (notification:${notificationMeta.labelName} {idempotencyKey: $idempotencyKey})
      ON CREATE SET
        notification.id = $notificationId,
        notification.notificationType = $notificationType,
        notification.isRead = false,
        notification.createdAt = datetime(),
        notification.updatedAt = datetime()

      WITH notification, recipient, actor${targetAliases.length ? `, ${targetAliases.join(", ")}` : ""},
           notification.id = $notificationId AS justCreated

      FOREACH (_ IN CASE WHEN justCreated THEN [1] ELSE [] END |
        MERGE (notification)-[:BELONGS_TO]->(company)
        MERGE (notification)-[:TRIGGERED_FOR]->(recipient)
      )

      FOREACH (_ IN CASE WHEN justCreated AND actor IS NOT NULL THEN [1] ELSE [] END |
        MERGE (notification)-[:TRIGGERED_BY]->(actor)
      )
      ${targetAliases
        .map(
          (alias) => `
      FOREACH (_ IN CASE WHEN justCreated AND ${alias} IS NOT NULL THEN [1] ELSE [] END |
        MERGE (notification)-[:REFERS_TO]->(${alias})
      )`,
        )
        .join("")}
    `;

    await this.neo4j.writeOne(writeQuery);

    // Step 2: Read back the node's id. If it equals the id we just generated, we created it;
    // otherwise a prior call (same idempotencyKey) already exists and won.
    const readResult = await this.neo4j.read(
      // nja-lint-ignore: idempotency read-back by server-generated unique key — scalar id only
      `MATCH (n:${notificationMeta.labelName} {idempotencyKey: $idempotencyKey}) RETURN n.id AS id`,
      { idempotencyKey: params.idempotencyKey },
    );
    const actualId = readResult.records[0]?.get("id");
    return { created: actualId === notificationId };
  }
}
