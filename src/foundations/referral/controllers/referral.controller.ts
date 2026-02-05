import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import { FastifyReply } from "fastify";

import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { ReferralInviteDTO } from "../dtos/referral-invite.dto";
import { referralMeta } from "../entities/referral.meta";
import { REFERRAL_CONFIG, ReferralModuleConfig } from "../interfaces/referral.config.interface";
import { ReferralService } from "../services/referral.service";

@UseGuards(JwtAuthGuard)
@Controller()
export class ReferralController {
  constructor(
    private readonly referralService: ReferralService,
    @Inject(REFERRAL_CONFIG) private readonly config: Required<ReferralModuleConfig>,
  ) {}

  /**
   * Check if the referral feature is enabled.
   * Throws NotFoundException when disabled to return 404 to clients.
   */
  private checkEnabled(): void {
    if (!this.config.enabled) {
      throw new NotFoundException("Referral feature is not enabled");
    }
  }

  /**
   * GET /referrals/my-code - Get or generate company referral code
   * Returns JSON:API format response
   */
  @Get(`${referralMeta.endpoint}/my-code`)
  async getMyCode(@Res() reply: FastifyReply): Promise<void> {
    this.checkEnabled();
    const response = await this.referralService.getMyCodeJsonApi();
    reply.send(response);
  }

  /**
   * POST /referrals/invite - Send referral invitation email
   * Returns 204 No Content on success
   */
  @Post(`${referralMeta.endpoint}/invite`)
  @HttpCode(HttpStatus.NO_CONTENT)
  async sendInvite(@Res() reply: FastifyReply, @Body() body: ReferralInviteDTO): Promise<void> {
    this.checkEnabled();
    await this.referralService.sendReferralInvite({ email: body.email });
    reply.send();
  }

  /**
   * GET /referrals/stats - Get referral statistics
   * Returns JSON:API format response
   */
  @Get(`${referralMeta.endpoint}/stats`)
  async getStats(@Res() reply: FastifyReply): Promise<void> {
    this.checkEnabled();
    const response = await this.referralService.getStatsJsonApi();
    reply.send(response);
  }
}
