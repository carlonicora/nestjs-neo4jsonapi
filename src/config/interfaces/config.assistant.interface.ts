export interface ConfigAssistantInterface {
  /**
   * Whether assistant answers may link the records they name, as
   * `[Name](mention://<type>/<id>)`. Only AssistantService turns use it.
   * @default false
   */
  inlineEntityLinks?: boolean;
}
