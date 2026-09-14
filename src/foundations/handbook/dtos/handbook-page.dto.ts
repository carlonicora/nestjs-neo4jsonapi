import { Type } from "class-transformer";
import { Equals, IsNotEmpty, IsUUID, ValidateNested } from "class-validator";
import { handbookPageMeta } from "../entities/handbook-page.meta";

export class HandbookPageDTO {
  @Equals(handbookPageMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;
}

export class HandbookPageDataDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => HandbookPageDTO)
  data: HandbookPageDTO;
}

export class HandbookPageDataListDTO {
  @ValidateNested({ each: true })
  @IsNotEmpty()
  @Type(() => HandbookPageDTO)
  data: HandbookPageDTO[];
}
