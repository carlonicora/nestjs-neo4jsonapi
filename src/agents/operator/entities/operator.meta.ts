import { DataMeta } from "../../../common/interfaces/datamodel.interface";

/**
 * Non-entity meta for the standalone operator endpoints (mirrors `authMeta`):
 * the operator module exposes routes but has no Neo4j node of its own — the
 * persisted resources are Assistants / AssistantMessages / AssistantActions.
 */
export const operatorMeta: DataMeta = {
  type: "operator",
  endpoint: "operator",
  nodeName: "operator",
  labelName: "Operator",
};
