import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiSingleDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { DiscordConnection, DiscordConnectionDescriptor } from "../entities/discord-connection";
import { DiscordConnectionRepository } from "../repositories/discord-connection.repository";

@Injectable()
export class DiscordConnectionService extends AbstractService<
  DiscordConnection,
  typeof DiscordConnectionDescriptor.relationships
> {
  protected readonly descriptor = DiscordConnectionDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly discordConnectionRepository: DiscordConnectionRepository,
    clsService: ClsService,
  ) {
    super(jsonApiService, discordConnectionRepository, clsService, DiscordConnectionDescriptor.model);
  }

  /** The caller's own Discord connection; any other id answers 404. */
  async findById(params: { id: string }): Promise<JsonApiSingleDocument> {
    const connection = await this.discordConnectionRepository.findCurrent({ id: params.id });
    return this.jsonApiService.buildSingle(DiscordConnectionDescriptor.model, connection);
  }
}
