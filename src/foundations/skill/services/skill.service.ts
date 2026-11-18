import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import {
  JsonApiListDocument,
  JsonApiSingleDocument,
} from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService, JsonApiDTOData } from "../../../core/neo4j/abstracts/abstract.service";
import { companyMeta } from "../../company/entities/company.meta";
import { Skill, SkillDescriptor } from "../entities/skill";
import { skillMeta } from "../entities/skill.meta";
import { SkillRepository } from "../repositories/skill.repository";

/** At most 30 skills per company, copies included, switched-off ones counted (spec §5). */
export const SKILL_LIMIT = 30;

/**
 * Skills of the company in context (Company Administrator routes, plus the active list every
 * role reads) and global skills (Administrator routes, decision P2).
 *
 * The framework's write path matches an unscoped entity by bare id, so every company write
 * first reads the skill through SkillRepository.findScopedById() and answers 404 when the
 * caller cannot see it; every Administrator write reads through findGlobalById().
 */
@Injectable()
export class SkillService extends AbstractService<Skill, typeof SkillDescriptor.relationships> {
  protected readonly descriptor = SkillDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly skillRepository: SkillRepository,
    clsService: ClsService,
  ) {
    super(jsonApiService, skillRepository, clsService, SkillDescriptor.model);
  }

  // ---------------------------------------------------------------------------
  // Standard CRUD entry points (createCrudHandlers in SkillController)
  // ---------------------------------------------------------------------------

  /** The inherited list, scoped to the company in context. */
  async find(params: {
    query: any;
    term?: string;
    fetchAll?: boolean;
    orderBy?: string;
    sort?: string;
  }): Promise<JsonApiListDocument> {
    return this.findForCompany({ query: params.query, term: params.term, sort: params.sort });
  }

  /** The inherited read, scoped: another company's skill answers 404. */
  async findById(params: { id: string }): Promise<JsonApiSingleDocument> {
    return this.findOneForCompany(params);
  }

  /** The inherited create: an own skill or a copy, with the rules of spec section 6. */
  async createFromDTO(params: { data: JsonApiDTOData; included?: unknown[] }): Promise<JsonApiSingleDocument> {
    return this.createForCompany({ data: params.data });
  }

  /** The inherited full update: own skills and copies only. */
  async putFromDTO(params: { data: JsonApiDTOData; included?: unknown[] }): Promise<JsonApiSingleDocument> {
    return this.update({ data: params.data });
  }

  /** The inherited delete: an own skill, or a copy ("Restore original"). */
  async delete(params: { id: string }): Promise<void> {
    return this.remove(params);
  }

  // ---------------------------------------------------------------------------
  // Company routes
  // ---------------------------------------------------------------------------

  /** GET skills: the company's list with per-company states. */
  async findForCompany(params: { query: any; term?: string; sort?: string }): Promise<JsonApiListDocument> {
    this.requireCompany();
    const paginator = new JsonApiPaginator(params.query);
    const data = await this.skillRepository.findForCompany({
      cursor: paginator.generateCursor(),
      term: params.term,
      orderByFields: this.parseSort(params.sort),
    });
    return this.jsonApiService.buildList(SkillDescriptor.model, data, paginator);
  }

  /** GET skills/active: name and description only, never the instructions. */
  async findActive(): Promise<JsonApiListDocument> {
    const data = await this.skillRepository.findActiveForCompany();
    const summaries = data.map((skill) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { instructions, original, company, ...rest } = skill;
      return rest as Skill;
    });
    return this.jsonApiService.buildList(SkillDescriptor.model, summaries);
  }

  /** GET skills/:skillId */
  async findOneForCompany(params: { id: string }): Promise<JsonApiSingleDocument> {
    this.requireCompany();
    const skill = await this.findVisible(params.id);
    return this.jsonApiService.buildSingle(SkillDescriptor.model, skill);
  }

  /** POST skills: an own skill, or a copy of a global when `relationships.original` is sent. */
  async createForCompany(params: { data: JsonApiDTOData }): Promise<JsonApiSingleDocument> {
    const companyId = this.requireCompany();
    const originalRelationship = params.data.relationships?.original?.data;
    const originalId = Array.isArray(originalRelationship) ? undefined : originalRelationship?.id;

    if (originalId) return this.createCopy({ data: params.data, companyId, originalId });

    await this.assertCompanyNameFree({ name: params.data.attributes?.name });
    await this.assertBelowLimit();

    return super.createFromDTO({
      data: {
        id: params.data.id,
        type: skillMeta.type,
        attributes: {
          ...params.data.attributes,
          isActive: params.data.attributes?.isActive ?? true,
          isGlobal: false,
        },
        relationships: { company: { data: { type: companyMeta.type, id: companyId } } },
      },
    });
  }

  /** PUT skills/:skillId: own skills and copies; a copy keeps its name. */
  async update(params: { data: JsonApiDTOData }): Promise<JsonApiSingleDocument> {
    this.requireCompany();
    const existing = await this.findVisible(params.data.id);
    if (existing.isGlobal) throw new ForbiddenException("skill.global_readonly");

    const isCopy = existing.origin === "copy";
    const name = isCopy ? existing.name : params.data.attributes?.name;
    if (!isCopy && name !== existing.name) await this.assertCompanyNameFree({ name, excludeId: existing.id });

    return super.putFromDTO({
      data: {
        id: params.data.id,
        type: skillMeta.type,
        attributes: {
          ...params.data.attributes,
          name,
          isActive: params.data.attributes?.isActive ?? existing.isActive,
        },
      },
    });
  }

  /** DELETE skills/:skillId: deletes an own skill, or a copy ("Restore original"). */
  async remove(params: { id: string }): Promise<void> {
    this.requireCompany();
    const existing = await this.findVisible(params.id);
    if (existing.isGlobal) throw new ForbiddenException("skill.global_readonly");
    if (existing.origin === "copy" && existing.canRestore !== true) throw new ConflictException("skill.changed");
    await this.skillRepository.delete({ id: params.id });
  }

  /** POST skills/:skillId/enable|disable: a global for the company, or an own skill / copy. */
  async setEnabled(params: { id: string; enabled: boolean }): Promise<JsonApiSingleDocument> {
    this.requireCompany();
    const existing = await this.findVisible(params.id);

    if (existing.isGlobal) {
      if (existing.isHidden) throw new ConflictException("skill.changed");
      // Replaced by the company's copy (the OVERRIDES edge, never the name: a copy keeps its old name).
      if (await this.skillRepository.isCopiedByCompany({ id: params.id })) throw new ConflictException("skill.changed");
      await this.skillRepository.setDisabledForCompany({ id: params.id, disabled: !params.enabled });
    } else {
      await this.skillRepository.patch({ id: params.id, isActive: params.enabled });
    }

    return this.jsonApiService.buildSingle(SkillDescriptor.model, await this.findVisible(params.id));
  }

  // ---------------------------------------------------------------------------
  // Administrator routes (global skills only)
  // ---------------------------------------------------------------------------

  /** GET skills/global */
  async findGlobal(params: { query: any; term?: string; sort?: string }): Promise<JsonApiListDocument> {
    const paginator = new JsonApiPaginator(params.query);
    const data = await this.skillRepository.findGlobal({
      cursor: paginator.generateCursor(),
      term: params.term,
      orderByFields: this.parseSort(params.sort),
    });
    return this.jsonApiService.buildList(SkillDescriptor.model, data, paginator);
  }

  /** GET skills/global/:skillId */
  async findOneGlobal(params: { id: string }): Promise<JsonApiSingleDocument> {
    return this.jsonApiService.buildSingle(SkillDescriptor.model, await this.findGlobalOrFail(params.id));
  }

  /** POST skills/global: relationships are ignored, a global never has a company edge. */
  async createGlobal(params: { data: JsonApiDTOData }): Promise<JsonApiSingleDocument> {
    const name = params.data.attributes?.name;
    if (await this.skillRepository.findGlobalNameClash({ name })) throw new ConflictException("skill.name_taken");

    await this.skillRepository.create(
      this.mapDTOToParams({
        id: params.data.id,
        type: skillMeta.type,
        attributes: {
          ...params.data.attributes,
          isActive: params.data.attributes?.isActive ?? true,
          isGlobal: true,
        },
      }),
    );

    // Read back unscoped: an inactive global is not visible through the company read.
    return this.jsonApiService.buildSingle(SkillDescriptor.model, await this.findGlobalOrFail(params.data.id));
  }

  /** PUT skills/global/:skillId */
  async updateGlobal(params: { data: JsonApiDTOData }): Promise<JsonApiSingleDocument> {
    const existing = await this.findGlobalOrFail(params.data.id);
    const name = params.data.attributes?.name;
    if (name !== existing.name && (await this.skillRepository.findGlobalNameClash({ name, excludeId: existing.id }))) {
      throw new ConflictException("skill.name_taken");
    }

    await this.skillRepository.put(
      this.mapDTOToParams(
        {
          id: params.data.id,
          type: skillMeta.type,
          attributes: { ...params.data.attributes, isActive: params.data.attributes?.isActive ?? existing.isActive },
        },
        "put",
      ),
    );

    return this.jsonApiService.buildSingle(SkillDescriptor.model, await this.findGlobalOrFail(params.data.id));
  }

  /** DELETE skills/global/:skillId: companies that copied it keep their copy. */
  async removeGlobal(params: { id: string }): Promise<void> {
    await this.findGlobalOrFail(params.id);
    await this.skillRepository.delete({ id: params.id });
  }

  /** POST skills/global/:skillId/enable|disable */
  async setGlobalActive(params: { id: string; active: boolean }): Promise<JsonApiSingleDocument> {
    await this.findGlobalOrFail(params.id);
    await this.skillRepository.patch({ id: params.id, isActive: params.active });
    return this.jsonApiService.buildSingle(SkillDescriptor.model, await this.findGlobalOrFail(params.id));
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async createCopy(params: {
    data: JsonApiDTOData;
    companyId: string;
    originalId: string;
  }): Promise<JsonApiSingleDocument> {
    const original = await this.findVisible(params.originalId);

    if (!original.isGlobal || original.origin !== "global" || original.isHidden) {
      throw new ConflictException("skill.changed");
    }
    // Already copied by the company (the OVERRIDES edge, never the name: a copy keeps its old name).
    if (await this.skillRepository.isCopiedByCompany({ id: params.originalId })) {
      throw new ConflictException("skill.changed");
    }
    await this.assertBelowLimit();

    const document = await super.createFromDTO({
      data: {
        id: params.data.id,
        type: skillMeta.type,
        attributes: {
          ...params.data.attributes,
          name: original.name,
          isActive: original.isEnabled === true,
          isGlobal: false,
        },
        relationships: {
          original: { data: { type: skillMeta.type, id: params.originalId } },
          company: { data: { type: companyMeta.type, id: params.companyId } },
        },
      },
    });

    // A later "Restore original" must bring the global back switched on.
    if (original.isEnabled !== true) {
      await this.skillRepository.setDisabledForCompany({ id: params.originalId, disabled: false });
    }

    return document;
  }

  /** The company in context; a Company Administrator route without one answers 404. */
  private requireCompany(): string {
    const companyId = this.clsService.get("companyId");
    if (!companyId) throw new NotFoundException();
    return companyId;
  }

  private async findVisible(id: string): Promise<Skill> {
    const skill = await this.skillRepository.findScopedById({ id });
    if (!skill) throw new NotFoundException();
    return skill;
  }

  private async findGlobalOrFail(id: string): Promise<Skill> {
    const skill = await this.skillRepository.findGlobalById({ id });
    if (!skill) throw new NotFoundException();
    return skill;
  }

  private async assertCompanyNameFree(params: { name: string; excludeId?: string }): Promise<void> {
    const clash = await this.skillRepository.findNameClash(params);
    if (clash === "own") throw new ConflictException("skill.name_taken");
    if (clash === "global") throw new ConflictException("skill.name_global");
  }

  private async assertBelowLimit(): Promise<void> {
    if ((await this.skillRepository.countOwn()) >= SKILL_LIMIT) {
      throw new UnprocessableEntityException("skill.limit_reached");
    }
  }
}
