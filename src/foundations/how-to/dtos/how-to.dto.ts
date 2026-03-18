import { Type } from "class-transformer";
import { Equals, IsNotEmpty, IsUUID, ValidateNested } from "class-validator";
import { howToMeta } from "../entities/how-to.meta";

export class HowToDTO {
  @Equals(howToMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;
}

export class HowToDataDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => HowToDTO)
  data: HowToDTO;
}

export class HowToDataListDTO {
  @ValidateNested({ each: true })
  @IsNotEmpty()
  @Type(() => HowToDTO)
  data: HowToDTO[];
}
