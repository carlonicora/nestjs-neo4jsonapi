import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { User } from "../../user/entities/user";
import { userMeta } from "../../user/entities/user.meta";
import { notificationMeta } from "./notification.meta";

/**
 * Notification Entity Type
 *
 * An in-app notification raised for a single recipient user. The graph shape is
 * `(notification)-[:TRIGGERED_FOR]->(:User)` for the recipient,
 * `(notification)-[:TRIGGERED_BY]->(:User)` for the actor, and
 * `(notification)-[:REFERS_TO]->(subject)` for whatever the notification is
 * about (the "subject"). The list query REQUIRES at least one REFERS_TO edge —
 * see `NotificationRepository.findForUser` — so a notification created without
 * a subject is invisible to the very list it was created for.
 *
 * Replaces the hand-written quartet (`notification.entity.ts`,
 * `notification.map.ts`, `notification.model.ts`,
 * `serialisers/notifications.serialiser.ts` — all deleted). The attribute and
 * relationship surface below reproduces the old `NotificationSerialiser.create()`
 * byte for byte: attributes `notificationType`, `isRead`, `message`,
 * `actionUrl`; a single to-one `actor` relationship pointing at the User model
 * (the old serialiser declared it under key `user` with `name: "actor"`, which
 * put `actor` on the wire — the descriptor reaches the same wire key with key
 * `actor` + `dtoKey: "actor"`).
 */
export type Notification = Entity & {
  notificationType: string;
  isRead: boolean;
  message?: string;
  actionUrl?: string;

  actor?: User;
};

/**
 * Notification Entity Descriptor
 *
 * Single source of truth for the Notification entity configuration. Generates
 * the mapper, the children tokens and the DataModelInterface automatically.
 *
 * `isCompanyScoped` is left at its default (`true`): every notification is
 * written with a `(notification)-[:BELONGS_TO]->(company)` edge and every query
 * in the repository joins `company`. The old hand-written model declared
 * `singleChildrenTokens: [userMeta.nodeName]`; the descriptor derives
 * `["company", "user"]` — the extra `company` token is inert on the wire (the
 * serialiser only emits `relationships` declared below) and inert in entity
 * mapping (no query RETURNs a `notification_company` column).
 *
 * No top-level `description`/`chat` block: the chatbot copy for a notification
 * is application-specific (it describes each app's own notification types and
 * subjects) and is supplied by the consuming app's extended descriptor. The
 * per-field `description`s live here so an extended descriptor can spread
 * `NotificationDescriptor.fields` and inherit them.
 *
 * Consuming apps that need more attributes, more subjects or a polymorphic
 * actor register an EXTENDED descriptor (`modelRegistry`, last write wins) and
 * subclass `NotificationRepository` — the narrowed-extend pattern used for
 * user/auth/company/tokenusage. The package default stays User-only actor +
 * `message`/`actionUrl`.
 */
export const NotificationDescriptor = defineEntity<Notification>()({
  ...notificationMeta,

  fields: {
    notificationType: {
      type: "string",
      required: true,
      description:
        'The event that triggered the notification (e.g. "MENTION", "TASK_ASSIGNED"). Drives the message text and icon shown to the recipient.',
    },
    isRead: {
      type: "boolean",
      required: true,
      description: "Whether the recipient has opened/acknowledged this notification.",
    },
    message: {
      type: "string",
      description: "Pre-rendered message text shown to the recipient.",
    },
    actionUrl: {
      type: "string",
      description: "URL the recipient is sent to when acting on the notification.",
    },
  },

  relationships: {
    actor: {
      model: userMeta,
      direction: "out",
      relationship: "TRIGGERED_BY",
      cardinality: "one",
      required: false,
      dtoKey: "actor",
      description: "The user whose action triggered this notification.",
    },
  },
});

export type NotificationDescriptorType = typeof NotificationDescriptor;

/**
 * Back-compat alias for the pre-descriptor `NotificationModel` export (the
 * `entities/notification.model.ts` file it used to live in is deleted). Mirrors
 * `FeatureModel` in `foundations/feature/entities/feature.model.ts`.
 */
export const NotificationModel = NotificationDescriptor.model;
