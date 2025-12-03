/**
 * Company configurations re-export.
 * Applications should extend AbstractCompanyConfigurations with their own implementation.
 */
import { AbstractCompanyConfigurations } from "../common/abstracts/abstract.company.configuration";

export { AbstractCompanyConfigurations };

/**
 * CompanyConfigurations class - applications should provide their own implementation
 * that extends AbstractCompanyConfigurations.
 *
 * This class exists for backwards compatibility.
 * Use COMPANY_CONFIGURATIONS_FACTORY token to inject your implementation.
 */
export class CompanyConfigurations extends AbstractCompanyConfigurations {
  loadConfigurations(_params: { neo4j: any }): Promise<void> {
    return;
  }
}
