import { Body, Controller, Logger, Post, Req, UseGuards } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ChatbotService } from "../services/chatbot.service";
import { UserModulesRepository } from "../repositories/user-modules.repository";
import { AssistantRequestDto } from "../dto/assistant.request.dto";
import { AssistantDescriptor } from "../entities/assistant";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";

@Controller("assistants")
@UseGuards(JwtAuthGuard)
export class AssistantController {
  private readonly logger = new Logger(AssistantController.name);

  constructor(
    private readonly chatbot: ChatbotService,
    private readonly userModules: UserModulesRepository,
    private readonly jsonApi: JsonApiService,
  ) {}

  @Post()
  async post(@Body() body: AssistantRequestDto, @Req() req: AuthenticatedRequest): Promise<any> {
    this.logger.log(
      `post: userId=${req.user.userId} companyId=${req.user.companyId} roles=${JSON.stringify(req.user.roles)} messageCount=${body.data.attributes.messages.length}`,
    );
    const userModules = await this.userModules.findModulesForRoles(req.user.roles);

    const response = await this.chatbot.run({
      companyId: req.user.companyId,
      userId: req.user.userId,
      userModules,
      messages: body.data.attributes.messages,
    });

    return this.jsonApi.buildSingle(AssistantDescriptor.model, {
      id: randomUUID(),
      answer: response.answer,
      needsClarification: response.needsClarification,
      suggestedQuestions: response.suggestedQuestions,
      references: response.references,
      tokens: response.tokens,
      toolCalls: response.toolCalls,
    });
  }
}
