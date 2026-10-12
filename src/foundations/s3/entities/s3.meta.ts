import { DataMeta } from "../../../common/interfaces/datamodel.interface";

export const s3Meta: DataMeta = {
  type: "s3",
  endpoint: "s3",
  nodeName: "s3",
  labelName: "S3",
};

/** Path segment of the token-verified object routes: `${s3Meta.endpoint}/${S3_OBJECTS_SEGMENT}/:token`. */
export const S3_OBJECTS_SEGMENT = "objects";
