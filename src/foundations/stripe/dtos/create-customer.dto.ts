import { IsEmail, IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateCustomerDTO {
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  name: string;

  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(3)
  currency: string;
}
