import { Entity } from "../../../common/abstracts/entity";

export type Module = Entity & {
  name: string;

  permissions: {
    create?: boolean | string;
    read?: boolean | string;
    update?: boolean | string;
    delete?: boolean | string;
  };
};
