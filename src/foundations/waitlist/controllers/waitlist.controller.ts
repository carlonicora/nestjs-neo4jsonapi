import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { RoleId } from "../../../common/constants/system.roles";
import { Roles } from "../../../common/decorators/roles.decorator";
import { AdminJwtAuthGuard } from "../../../common/guards/jwt.auth.admin.guard";
import { WaitlistInviteBatchDTO } from "../dtos/waitlist.invite.dto";
import { WaitlistPostDTO } from "../dtos/waitlist.post.dto";
import { WaitlistStatus } from "../entities/waitlist";
import { waitlistMeta } from "../entities/waitlist.meta";
import { WaitlistService } from "../services/waitlist.service";

@Controller(waitlistMeta.endpoint)
export class WaitlistController {
  constructor(private readonly service: WaitlistService) {}

  /**
   * POST /waitlists - Submit to waitlist (public)
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async submit(@Body() body: WaitlistPostDTO) {
    if (!body.data.attributes.gdprConsent) {
      throw new HttpException("GDPR consent is required", HttpStatus.BAD_REQUEST);
    }
    return await this.service.createEntry({ data: body.data });
  }

  /**
   * GET /waitlists/confirm/:code - Confirm email (public)
   */
  @Get("confirm/:code")
  async confirm(@Param("code") code: string) {
    return await this.service.confirm({ code });
  }

  /**
   * GET /waitlists/stats - Get statistics (admin only)
   */
  @Get("stats")
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  async getStats() {
    const stats = await this.service.getStats();
    return {
      data: {
        type: "waitlist-stats",
        attributes: stats,
      },
    };
  }

  /**
   * GET /waitlists - List all entries (admin only)
   */
  @Get()
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  async findAll(@Query() query: any, @Query("status") status?: WaitlistStatus) {
    return await this.service.findAllByStatus({ query, status });
  }

  /**
   * POST /waitlists/:id/invite - Send invite (admin only)
   */
  @Post(":id/invite")
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  async invite(@Param("id") id: string) {
    return await this.service.invite({ id });
  }

  /**
   * POST /waitlists/invite-batch - Bulk invite (admin only)
   */
  @Post("invite-batch")
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  async inviteBatch(@Body() body: WaitlistInviteBatchDTO) {
    const result = await this.service.inviteBatch({ ids: body.data.attributes.ids });
    return {
      data: {
        type: "waitlist-batch-result",
        attributes: result,
      },
    };
  }

  /**
   * GET /waitlists/invite/:code - Validate invite code (public)
   */
  @Get("invite/:code")
  async validateInviteCode(@Param("code") code: string) {
    const result = await this.service.validateInviteCode(code);

    if (!result) {
      throw new HttpException("Invalid invitation code", HttpStatus.NOT_FOUND);
    }

    return {
      data: {
        type: "invite-validation",
        attributes: result,
      },
    };
  }
}
