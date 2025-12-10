import { Controller, Get } from "@nestjs/common";
import { VersionService } from "../services/version.service";

@Controller("version")
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  @Get()
  getVersion() {
    return { version: this.versionService.getVersion() };
  }
}
