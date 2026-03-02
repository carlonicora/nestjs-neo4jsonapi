import { Entity } from "../../../common/abstracts/entity";

export type PermissionMapping = Entity & {
  roleId: string;
  moduleId: string;
  permissions: {
    create?: boolean | string;
    read?: boolean | string;
    update?: boolean | string;
    delete?: boolean | string;
  };
};
