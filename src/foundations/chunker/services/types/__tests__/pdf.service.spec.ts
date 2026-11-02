import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { BaseConfigInterface } from "../../../../../config/interfaces/base.config.interface";
import { PdfService } from "../pdf.service";

function share(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length / text.length;
}

describe("PdfService.isGarbageOcrOutput", () => {
  const configStub = { get: () => undefined } as unknown as ConfigService<BaseConfigInterface>;
  const service = new PdfService(configStub);
  // Test-only access: the method stays private on the class.
  const check = (service as unknown as { isGarbageOcrOutput(text: string): boolean }).isGarbageOcrOutput.bind(service);

  it("accepts Italian legal text where digits are about 20% of the characters", () => {
    const text = [
      "Sentenza n. 1234/2024 del 12/03/2024, R.G. 5678/2023, depositata il 18/04/2024.",
      "Il Tribunale di Milano, in composizione monocratica, condanna il convenuto al pagamento",
      "di € 15.430,00 oltre interessi dal 01/01/2023 al 31/12/2023 e spese per € 2.150,00",
      "ai sensi degli artt. 1218, 1223 e 2043 del codice civile, rilevato che la notifica",
      "prot. 98765 del 05/06/2024 risulta regolarmente eseguita presso la residenza",
      "del debitore, come attestato dalla relata 4521 del 07/06/2024.",
    ].join("\n");

    const letters = share(text, /[a-zA-ZÀ-ÿ]/g);
    const digits = share(text, /\d/g);
    expect(letters).toBeGreaterThanOrEqual(0.55);
    expect(letters).toBeLessThanOrEqual(0.58);
    expect(digits).toBeGreaterThanOrEqual(0.2);
    expect(digits).toBeLessThanOrEqual(0.22);

    expect(check(text)).toBe(false);
  });

  it("rejects symbol noise that only Check 2 catches", () => {
    const text = "atto @ # % & * = § verbale + _ / - | documento @ # % & = ".repeat(8).trim();

    const letterCount = (text.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
    const whitespaceCount = (text.match(/\s/g) || []).length;
    const digitCount = (text.match(/\d/g) || []).length;
    expect(share(text, /[§|{}[\]\\<>«»°^~`]/g)).toBeLessThan(0.15);
    expect(share(text, /[!?.,;:]/g)).toBeLessThan(0.2);
    expect(text).not.toMatch(/[§]{3,}|[|]{3,}|[{}[\]]{3,}|[!]{3,}|[']{5,}/);
    expect(letterCount / (text.length - whitespaceCount - digitCount)).toBeLessThan(0.6);

    expect(check(text)).toBe(true);
  });

  it("rejects text where most words mix letters and digits", () => {
    expect(check("l1l1 0O0o 5S5s rn1m 8B8b ".repeat(20))).toBe(true);
  });

  it("rejects text under 10 characters", () => {
    expect(check("abc 12")).toBe(true);
  });
});
