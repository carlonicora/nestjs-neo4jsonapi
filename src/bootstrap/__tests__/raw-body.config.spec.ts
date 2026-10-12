import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fastify, { FastifyInstance } from "fastify";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Readable } from "stream";
import { S3Cipher } from "../../foundations/s3/cipher/s3-cipher.core";
import { defaultFastifyOptions } from "../defaults";
import { setupS3ObjectUploadStreaming } from "../raw-body.config";

describe("setupS3ObjectUploadStreaming", () => {
  let instance: FastifyInstance;

  beforeEach(async () => {
    instance = fastify(defaultFastifyOptions);
    const app = { getHttpAdapter: () => ({ getInstance: () => instance }) } as unknown as NestFastifyApplication;
    setupS3ObjectUploadStreaming(app);

    instance.put("/s3/objects/:t", async (req) => {
      let length = 0;
      for await (const chunk of req.body as Readable) length += (chunk as Buffer).length;
      return String(length);
    });
    instance.put("/other", async () => "ok");
    await instance.ready();
  });

  afterEach(async () => {
    await instance.close();
  });

  it("hands the raw body stream to PUT /s3/objects/:token whatever the content type", async () => {
    const response = await instance.inject({
      method: "PUT",
      url: "/s3/objects/token",
      headers: { "content-type": "application/pdf" },
      payload: Buffer.from("hello"),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("5");
  });

  it("accepts a real object token as the route param (longer than Fastify's 100-char default)", async () => {
    const cipher = new S3Cipher({
      enabled: true,
      key: { keyId: "k", material: Buffer.alloc(32, 1) },
      retiredKeys: [],
      plaintextPrefixes: [],
    });
    const token = cipher.signObjectToken({
      op: "put",
      key: `companies/${"a".repeat(36)}/documents/${"b".repeat(36)}/${"c".repeat(200)}.pdf`,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      expiresInSeconds: 3600,
    });

    const response = await instance.inject({
      method: "PUT",
      url: `/s3/objects/${token}`,
      headers: { "content-type": "application/pdf" },
      payload: Buffer.from("hello"),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("5");
  });

  it("answers 415 for application/octet-stream on any other route", async () => {
    const response = await instance.inject({
      method: "PUT",
      url: "/other",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("hello"),
    });

    expect(response.statusCode).toBe(415);
  });
});
