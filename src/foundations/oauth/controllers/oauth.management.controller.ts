import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, HttpCode, HttpException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { OAuthClientService } from "../services/oauth.client.service";
import { OAuthClientCreateDto, OAuthClientUpdateDto } from "../dtos/oauth.client.dto";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { CoreModuleId } from "../../../common/constants/core-module.ids";

/**
 * OAuth Client Management Controller
 *
 * CRUD operations for OAuth clients.
 * All endpoints require user authentication.
 *
 * Note: JSON:API serialization will be added by OAuthClientSerialiser
 * once the serializers module is complete.
 */
@ModuleACL({ module: CoreModuleId.OAuthClient })
@Controller("oauth/clients")
@UseGuards(JwtAuthGuard)
export class OAuthManagementController {
  constructor(
    private readonly clientService: OAuthClientService,
    private readonly cls: ClsService,
  ) {}

  /**
   * List User's OAuth Clients
   *
   * GET /oauth/clients
   */
  @Get()
  async list() {
    const userId = this.cls.get("userId");
    const clients = await this.clientService.getClientsByOwner(userId);

    // Return basic format - will be enhanced with JSON:API serializer
    return {
      data: clients.map((client) => ({
        type: "oauth-clients",
        id: client.clientId,
        attributes: {
          name: client.name,
          description: client.description,
          redirectUris: client.redirectUris,
          allowedScopes: client.allowedScopes,
          allowedGrantTypes: client.allowedGrantTypes,
          isConfidential: client.isConfidential,
          isActive: client.isActive,
          accessTokenLifetime: client.accessTokenLifetime,
          refreshTokenLifetime: client.refreshTokenLifetime,
        },
      })),
    };
  }

  /**
   * Create OAuth Client
   *
   * POST /oauth/clients
   *
   * Returns the client with client_secret (shown only once).
   */
  @Post()
  @HttpCode(201)
  async create(@Body() body: OAuthClientCreateDto) {
    const userId = this.cls.get("userId");
    const companyId = this.cls.get("companyId");

    const { client, clientSecret } = await this.clientService.createClient({
      name: body.data.attributes.name,
      description: body.data.attributes.description,
      redirectUris: body.data.attributes.redirectUris,
      allowedScopes: body.data.attributes.allowedScopes,
      allowedGrantTypes: body.data.attributes.allowedGrantTypes,
      isConfidential: body.data.attributes.isConfidential,
      accessTokenLifetime: body.data.attributes.accessTokenLifetime,
      refreshTokenLifetime: body.data.attributes.refreshTokenLifetime,
      ownerId: userId,
      companyId,
    });

    // Include clientSecret in response (only shown once)
    return {
      data: {
        type: "oauth-clients",
        id: client.clientId,
        attributes: {
          name: client.name,
          description: client.description,
          redirectUris: client.redirectUris,
          allowedScopes: client.allowedScopes,
          allowedGrantTypes: client.allowedGrantTypes,
          isConfidential: client.isConfidential,
          isActive: client.isActive,
          accessTokenLifetime: client.accessTokenLifetime,
          refreshTokenLifetime: client.refreshTokenLifetime,
          // Only returned on creation
          clientSecret,
        },
      },
    };
  }

  /**
   * Get OAuth Client
   *
   * GET /oauth/clients/:clientId
   */
  @Get(":clientId")
  async get(@Param("clientId") clientId: string) {
    const userId = this.cls.get("userId");
    const client = await this.clientService.getClient(clientId);

    if (!client) {
      throw new HttpException("Client not found", 404);
    }

    // Verify ownership
    if (client.owner?.id !== userId) {
      throw new HttpException("Access denied", 403);
    }

    return {
      data: {
        type: "oauth-clients",
        id: client.clientId,
        attributes: {
          name: client.name,
          description: client.description,
          redirectUris: client.redirectUris,
          allowedScopes: client.allowedScopes,
          allowedGrantTypes: client.allowedGrantTypes,
          isConfidential: client.isConfidential,
          isActive: client.isActive,
          accessTokenLifetime: client.accessTokenLifetime,
          refreshTokenLifetime: client.refreshTokenLifetime,
        },
      },
    };
  }

  /**
   * Update OAuth Client
   *
   * PATCH /oauth/clients/:clientId
   */
  @Patch(":clientId")
  async update(@Param("clientId") clientId: string, @Body() body: OAuthClientUpdateDto) {
    const userId = this.cls.get("userId");
    const existing = await this.clientService.getClient(clientId);

    if (!existing) {
      throw new HttpException("Client not found", 404);
    }

    // Verify ownership
    if (existing.owner?.id !== userId) {
      throw new HttpException("Access denied", 403);
    }

    const updated = await this.clientService.updateClient(clientId, {
      name: body.data.attributes.name,
      description: body.data.attributes.description,
      redirectUris: body.data.attributes.redirectUris,
      allowedScopes: body.data.attributes.allowedScopes,
      isActive: body.data.attributes.isActive,
    });

    return {
      data: {
        type: "oauth-clients",
        id: updated.clientId,
        attributes: {
          name: updated.name,
          description: updated.description,
          redirectUris: updated.redirectUris,
          allowedScopes: updated.allowedScopes,
          allowedGrantTypes: updated.allowedGrantTypes,
          isConfidential: updated.isConfidential,
          isActive: updated.isActive,
          accessTokenLifetime: updated.accessTokenLifetime,
          refreshTokenLifetime: updated.refreshTokenLifetime,
        },
      },
    };
  }

  /**
   * Delete OAuth Client
   *
   * DELETE /oauth/clients/:clientId
   */
  @Delete(":clientId")
  @HttpCode(204)
  async delete(@Param("clientId") clientId: string) {
    const userId = this.cls.get("userId");
    const existing = await this.clientService.getClient(clientId);

    if (!existing) {
      throw new HttpException("Client not found", 404);
    }

    // Verify ownership
    if (existing.owner?.id !== userId) {
      throw new HttpException("Access denied", 403);
    }

    await this.clientService.deleteClient(clientId);
  }

  /**
   * Regenerate Client Secret
   *
   * POST /oauth/clients/:clientId/regenerate-secret
   *
   * Returns new clientSecret (shown only once).
   */
  @Post(":clientId/regenerate-secret")
  async regenerateSecret(@Param("clientId") clientId: string) {
    const userId = this.cls.get("userId");
    const existing = await this.clientService.getClient(clientId);

    if (!existing) {
      throw new HttpException("Client not found", 404);
    }

    // Verify ownership
    if (existing.owner?.id !== userId) {
      throw new HttpException("Access denied", 403);
    }

    const { clientSecret } = await this.clientService.regenerateSecret(clientId);

    return {
      data: {
        type: "oauth-clients",
        id: existing.clientId,
        attributes: {
          name: existing.name,
          description: existing.description,
          redirectUris: existing.redirectUris,
          allowedScopes: existing.allowedScopes,
          allowedGrantTypes: existing.allowedGrantTypes,
          isConfidential: existing.isConfidential,
          isActive: existing.isActive,
          accessTokenLifetime: existing.accessTokenLifetime,
          refreshTokenLifetime: existing.refreshTokenLifetime,
          // New secret - only returned once
          clientSecret,
        },
      },
    };
  }
}
