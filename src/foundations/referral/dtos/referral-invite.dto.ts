import { IsEmail, IsNotEmpty, IsString } from "class-validator";

export class ReferralInviteDTO {
  @IsNotEmpty()
  @IsString()
  @IsEmail()
  email: string;
}
