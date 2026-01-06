## [1.21.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.20.0...v1.21.0) (2026-01-06)

### 🚀 Features

* add health check ([c3417a0](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/c3417a0c1bb40dbedfa467344ca76658b0b0140d))

## [1.20.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.19.0...v1.20.0) (2026-01-04)

### 🚀 Features

* allow submodules generation ([596307f](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/596307f5d6c8c7b1e6c714769699fc808ca3e8d8))

### ♻️ Chores

* remove unused import from stripe fixtures ([8fcb4cb](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/8fcb4cb12358a3f489a3a4056e8a5439c190de67))

## [1.19.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.18.0...v1.19.0) (2026-01-02)

### 🚀 Features

* centralised tests with vite ([68b6001](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/68b60017429d3a921ab31437e526924627be4376))
* centralised tests with vite ([1ab5faa](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/1ab5faafec6e7bfe98a7da1cc1cf2915c4e738e4))

## [1.18.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.17.0...v1.18.0) (2026-01-02)

### 🚀 Features

* add allowRegistration ([df71b74](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/df71b74e736429dcb601e3be0b70d0085a963f22))

## [1.17.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.16.0...v1.17.0) (2026-01-02)

### 🚀 Features

* add description and features fields to stripe prices ([4ffd666](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/4ffd666cdb0013ea24289c17d7ad9b255f15c52b))
* add stripe backend implementation ([684b332](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/684b332760f2dc054ce87e0419bb5c38ddac4be1))
* add stripe price archival and restore ([8605990](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/860599057964a6fda0b82842209905bbfba0d872))
* add stripe-prices to stripe-product ([1c80b9a](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/1c80b9ac0f0ba71f823b76295532547a16b56d6b))
* enhance DiscordUserRepository to include role and user metadata in return statement ([3326188](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/33261887ccb4ddb8307fb5a3fda46da41b754e3b))
* implement SCA-compliant payment confirmation flow for subscriptions ([690a9be](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/690a9bed794a418865d2bdde7ed96585c6deb519))
* implement Stripe payment methods handling and serialization ([659a1d1](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/659a1d1dfc0d8a8e411c63b321dd5e7435ca6f48))

### 🐛 Bug Fixes

* add payment method validation for subscription creation ([9eb1ec3](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/9eb1ec3e66ba121fc5aa51553051c9bc4baeba55))
* correct billing endpoint ([ef42a7f](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/ef42a7f8aeb64c59208419cbb6cf8051f72014f7))
* correct import paths ([9c3f1fb](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/9c3f1fb4557e1630b58375232dc15bec4d92862b))
* correct linting ([0e458ba](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/0e458baff16ea6ab1737f78499fb5d29a9240bb0))
* ensure user is active upon creation in DiscordUserService ([740b8df](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/740b8df5d61e78dcead17fa31e177d77d1f1206f))
* update module migration tool ([74db063](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/74db063e35a9b79c00feb2c055e74c2216d0c5ac))
* update stripe dependency to version 20.1.0 and adjust test imports ([3a9d45a](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/3a9d45a6ee6014015f938d74d7a8085514c6f271))
* update test files to latest implementation ([e6bac20](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/e6bac2077a81e0212d6f9738dfc90e5e61bda611))

### 📦 Code Refactoring

* consolidate stripe and billing into unified stripe foundation module ([10d5a07](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/10d5a076b57b88a3b90a1d10eb14539c528b75b4))
* move stripe customer ([88c907b](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/88c907bd107926d562c0413560e3f5e93cf8e168))
* move stripe invoice ([fd9bfa0](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/fd9bfa002381d263acc5ec51e4cbb7c1b019c941))
* move stripe invoice ([044414d](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/044414d98d79da5ad320d24352fe3ad59b586d97))
* move stripe price ([80263d7](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/80263d772534539e7d57a041a883477559ff1407))
* move stripe product ([8c27335](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/8c2733594e17f0a292adda5a8ae827811fb2802c))
* move stripe subscriptions ([371af3b](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/371af3b9497f3505dbee2d1f83522b1124a671e8))
* move stripe webhooks and usage ([15149e4](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/15149e44414b8aef61f897d4bb9bd7344b962745))
* rename product references to stripeProduct in StripePrice and StripeSubscription entities ([808a1bd](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/808a1bd7b8136c719bbcfaf8a597d225437e203f))
* skip company relationship handling in scoped contexts ([c9110c8](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/c9110c850992f57b9a743876cdf5f681a86cb67c))
* update import paths for DataModelInterface in Stripe models and adjust query in StripeSubscriptionRepository ([0ea82d2](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/0ea82d202cad09822068785866b8ab21eafb186d))
* update module imports to include Neo4JModule and StripeCustomerModule ([575e4ef](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/575e4efabd080707e4c9d37ac63b71e7164f75db))

## [1.16.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.15.0...v1.16.0) (2025-12-28)

### 🚀 Features

* enhance buildReturnStatement to aggregate edge properties for MANY relationships ([428eb74](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/428eb747c9f34e9a03f77665f2547d0b0bf5a76f))

### 📚 Documentation

* remove duplicate organization from valid key concepts in documentation ([2fa4401](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/2fa4401abaccedfc6f16bacf7b1c2d0d40f34363))

## [1.15.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.14.1...v1.15.0) (2025-12-27)

### 🚀 Features

* add message and actionUrl fields to Notification entity and update related mappings ([41737f6](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/41737f66fd8c820b3582cbf461c4cf734b8c6a30))

## [1.14.1](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.14.0...v1.14.1) (2025-12-27)

### 🐛 Bug Fixes

* update Brevo SDK usage for email sending with new authentication method ([d00b986](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/d00b986822f118f9379420c564e1af202e506e03))

## [1.14.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.13.1...v1.14.0) (2025-12-27)

### 🚀 Features

* enhance error response structure for improved frontend consumption ([d63aaab](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/d63aaab4998d813fbf5f020310a2cf4cc03ee535))
* integrate ClsService into repositories for enhanced security context handling ([79aba8c](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/79aba8cf9de7f7cefcbc552a17a654df8fb61b95))

### 🐛 Bug Fixes

* correct error detail extraction for consistent frontend response ([dee2ca8](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/dee2ca8f489589cc5fd2b84ed247700c6a449949))

## [1.13.1](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.13.0...v1.13.1) (2025-12-26)

### 📦 Code Refactoring

* streamline code for clarity and performance in various services ([55d9118](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/55d91183e05caf5610216d92f65b4cceb2985142))

## [1.13.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.12.0...v1.13.0) (2025-12-25)

### 🚀 Features

* enhance relationship handling to support edge properties for both SINGLE and MANY cardinalities ([d22cab3](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/d22cab33383cb8c307d1d7a40704c3a361a2b8a3))
* implement add/remove methods for MANY relationships with edge properties in repository and service ([877d8cd](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/877d8cd9e7e62b8600b8c99942dc427ca4fb66af))

## [1.12.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.11.0...v1.12.0) (2025-12-24)

### 🚀 Features

* extend expiration time for signed URLs to 12 hours ([acb0a12](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/acb0a12822364e9d4ad77ceadc4c4ef1519996a7))

## [1.11.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.10.0...v1.11.0) (2025-12-24)

### 🚀 Features

* update relationship handling to use 'required' instead of 'nullable' in DTOs and entities ([d2900e0](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/d2900e0ce24baf456b1a42c98862be0a65b629f7))

## [1.10.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.9.1...v1.10.0) (2025-12-21)

### 🚀 Features

* enhance relationship properties support in DTOs and services ([915cd5b](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/915cd5b6be59338d40468ac4770ea44a51d32a22))
* implement relationship properties support for DTOs and entities ([a9dbb31](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/a9dbb31c1daa67c5261df6d0ac2976b3c26e3862))

## [1.9.1](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.9.0...v1.9.1) (2025-12-21)

### 📦 Code Refactoring

* update entity references from Descriptor to Meta in controller and DTO templates ([f512fce](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/f512fceb0e454bab6bd27b0a8591dbf96581d6fe))

## [1.9.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.8.1...v1.9.0) (2025-12-20)

### 🚀 Features

* add conversion functions for Neo4j types and integrate into entity mapping ([32e4aa6](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/32e4aa6fa91d04afa7bf007df7b2197142cd75ba))

## [1.8.1](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.8.0...v1.8.1) (2025-12-18)

### 🐛 Bug Fixes

* remove debug logging from buildReturnStatement method in AbstractRepository ([0b66be1](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/0b66be1214b1990475021c8390e2d2a974a45483))

## [1.8.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.7.0...v1.8.0) (2025-12-18)

### 🚀 Features

* add buildReturnStatement method for enhanced query construction in DiscordUserRepository ([dfe2e4b](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/dfe2e4bc57be6d1b40afab74a5d00690f9a53798))

### 🐛 Bug Fixes

* adjust date formatting in query builders to ensure correct date handling ([d0251cd](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/d0251cdbdb9b52f4f13a91840325402895bd872e))

## [1.7.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.6.0...v1.7.0) (2025-12-18)

### 🚀 Features

* enhance company creation and update methods with relationship validation and dynamic query generation ([b09e070](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/b09e070f00d679864bbf81bb747904e189525731))
* enhance module generation with type normalization and validation decorators ([fcbdec2](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/fcbdec2e39db4124cfe1b6aa7495fce6df168de0))
* integrate ClsService for context management in DiscordUserService ([8b8e892](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/8b8e892d6e4f6d81cda278ffb893cec76cf52f8d))

### 🐛 Bug Fixes

* update AuthDiscordService to use config for app URL in token exchange response ([bafc1b1](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/bafc1b12851b8968c0e2b8f1b56a6a107bdb27c4))

## [1.6.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.5.1...v1.6.0) (2025-12-17)

### 🚀 Features

* add Discord module with service and error serializer ([741c003](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/741c0033dfef13b82a693dc1730c16281b0d4d0b))
* add meta file generation and update entity import paths to avoid circular dependencies ([de31185](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/de311850a3cb51cb5c12aa4da245e9383ade2f7c))
* add token and devGuildId to Discord configuration ([c838ebe](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/c838ebe68eb04f4fe31460e0f451e8f8a64c7484))
* enhance support for new entity structure and improve import resolution ([cd8a0c5](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/cd8a0c5b5f9513eb83acf52ffc9ed1a16c171f3e))
* implement DiscordUser module with service and types for user management ([36d986d](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/36d986d93a6d9efbe31ee0b6fae8c0b445f928ed))
* integrate Discord support with Necord and update configuration interfaces ([c0d44b3](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/c0d44b3b29c4e03d00fe8a807f23463e64bc12c6))

### 🐛 Bug Fixes

* correct import path for DiscordUserModule and refactor AuthDiscordService to utilize DiscordUserService ([56236d1](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/56236d1842483e2f9cbdeae53546bacbb1850490))
* optimize query parameter building to include only defined fields ([b5e95f2](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/b5e95f2da62a918bfe32ee1bec5b464ce53e3aa8))

### 📦 Code Refactoring

* remove unused CommunityDetectionResult interface from CommunityDetectorService ([b064762](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/b0647621f6e290824473fa79910b6f7d981cd60a))

## [1.5.1](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.5.0...v1.5.1) (2025-12-16)

### 💎 Styles

* correct file structure ([7d1da72](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/7d1da72e89b03c458807ad4d112b99dfdb3ca339))

## [1.5.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.4.1...v1.5.0) (2025-12-16)

### 🚀 Features

* add drift methodology ([13281f0](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/13281f0495b99849480908b37a199d0e12e59254))
* add drift to responder ([1ff378b](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/1ff378b4f2e3d57025d17d4d2bafc21f4794be93))
* add key concept count check before community detection and implement counting method ([377cf38](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/377cf3804296cad7ff57ff5b1b94762078d037ca))
* enhance KeyConceptRepository by adding ModelService and dynamic vector dimensions ([aec6bb9](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/aec6bb93f565e42c204db09ffacd8b4286b067cf))
* implement incremental assignment of KeyConcepts to existing communities ([4a14986](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/4a149865fe3fcc3e0de3716fd9d6307cf43bb454))
* integrate CommunitySummariserService for community summary generation ([96c3ae3](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/96c3ae39434c9ca83afaa9e0a1fa24b5197dad73))

### 🐛 Bug Fixes

* add DriftModule to ResponderModule imports ([0976a78](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/0976a78af1615214ac737dc0c57929d33f5698b1))
* add parameters to GDS cypher projection in projectGraph method ([438322f](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/438322f42fe8a7f33c08e1972304f6ed60681866))
* add validateRelationships parameter to Neo4j query for community detection ([a41b453](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/a41b453206b465f06e32bdcde4de0f9569c28d91))
* change community retrieval from read to write operation ([a115a9a](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/a115a9ad767b3e638a0b203a5c89cd7d83559db1))
* correct community exports ([9982b51](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/9982b513f8bf68e07ee2e970f6c9d284c2f48873))
* ensure integer limits in community repository queries ([6a7d923](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/6a7d923492081db96c6f593f5f37386796145ba1))
* handle potential null values in community detection and migration services ([1490f94](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/1490f94ec7cd0748d91b80ef307e0cac3c2321b0))
* optimize community level count retrieval to avoid entity serialization ([789596c](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/789596c0b311321139465407fab6f59045b04d9f))
* optimize community member retrieval to avoid entity serialization ([5a853d7](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/5a853d797186c8743c9f057e904c97e62eb54dc1))
* optimize Neo4j read operations to avoid entity serialization in community detection methods ([aef55a2](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/aef55a2dc29542ebb0ff78f2811a64731be03e1d))
* remove unsupported resolution parameter from Louvain algorithm query ([9bed811](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/9bed8110acc59df1a9c62e9a1a51d3c772b041ca))
* update Louvain resolutions to only support single level detection ([68456d2](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/68456d2ff116727cd8a449a63b85045abb7251bf))

## [1.4.1](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.4.0...v1.4.1) (2025-12-15)

### 🐛 Bug Fixes

* correct foundation generator ([7980244](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/7980244b437462657bea5bb952ab390dcd3f3e00))

## [1.4.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.3.1...v1.4.0) (2025-12-15)

### 🚀 Features

* add generator ([46fccbe](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/46fccbe431d6fbdfcc88b509bce7026821ea6728))

## [1.3.1](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.3.0...v1.3.1) (2025-12-15)

### 📦 Code Refactoring

* split discord auth from discord user ([578e996](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/578e996a1e84cc8863cee076ae91b0397f06679e))

## [1.3.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.2.1...v1.3.0) (2025-12-15)

### 🚀 Features

* add discord login ([2587717](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/2587717526ec17ec6ae1f0f015a5540e4ec72505))

## [1.2.1](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.2.0...v1.2.1) (2025-12-15)

### 🐛 Bug Fixes

* correct auth export ([00784a5](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/00784a5006d812115d8e00ef69f99f66fc50de6d))
* correct auth query ([508be9d](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/508be9dfcf67dff7b54d740e98bb617e2264294f))

## [1.2.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.1.0...v1.2.0) (2025-12-11)

### 🚀 Features

* create extendability in content module ([142db56](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/142db5615be23df478df8ece30475d902577de44))

## [1.1.0](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.0.3...v1.1.0) (2025-12-11)

### 🚀 Features

* add version controller ([614c809](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/614c8096abc73e38d1715ef95d77566016c42bde))

## [1.0.3](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.0.2...v1.0.3) (2025-12-10)

### 🐛 Bug Fixes

* upgrade npm to 11.5+ for OIDC trusted publishing ([5855f1f](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/5855f1f86bcae1a3b373ee4b5b09a14d5a2d27a5))

## [1.0.2](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.0.1...v1.0.2) (2025-12-10)

### 🐛 Bug Fixes

* add NPM_CONFIG_PROVENANCE env var for OIDC ([8b0787e](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/8b0787ef010694498354270375b6f3b0b0455fc0))

## [1.0.1](https://github.com/carlonicora/nestjs-neo4jsonapi/compare/v1.0.0...v1.0.1) (2025-12-10)

### 🐛 Bug Fixes

* enable provenance for npm OIDC publishing ([d0c98c7](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/d0c98c7e61d7898e9c26ccdf354495a0fd9b3cb3))

## 1.0.0 (2025-12-09)

### 🚀 Features

* add brevo to email sending ([c9cc485](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/c9cc485d33fa38e118e631d67159a56a6bb082c3))
* add centralised bootstrap ([afd8122](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/afd8122ba513b4938adcfb20d1ab1802f95b1c2f))
* add CI/CD for npm publishing ([462552d](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/462552d4a288a70bfa079b8af73e4baeba877fdd))
* add CI/CD for npm publishing ([b15ed23](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/b15ed2303216eaf578003c3f1f002806ecab3e6b))
* add company configurations ([7472267](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/7472267d4d8ce32942b404aeee5c052ec7cc1472))
* add configuration interfaces (Phase 2) ([9940093](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/9940093b9492d5733ddbe778751e8c0678a7d956))
* add content by author ([f9a4792](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/f9a479265cbb3fd8d5ce86f69cf26a2e6241933b))
* add GNU General Public License v3.0 to the project ([38f28e9](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/38f28e95ec235d9432dcd854323d3ae96852761f))
* add LICENSE file and update package license to GPL-3.0-or-later ([e7dbae2](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/e7dbae28d2d6c0f42c1fafa5acb257bce8e6459b))
* add llm tools support ([4ae8b32](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/4ae8b322c1774c63b9b866907bc35b0ee6501d69))
* add migration tool ([5b9b332](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/5b9b332f8f5808a93f7836c8e84f8bd20b12ae25))
* add new module architecture ([cccbd9f](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/cccbd9fb70107785187e5c543d7609be971adb74))
* add user dto to exported modules ([a303a59](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/a303a59bd8eae0d7c80c52f4a9ce6ef6c8c503c8))
* **common:** extract common module components ([b626917](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/b626917d5a59c1bf10dc70335fe3677e4ad335bd))
* enhance LLM caching with region-based provider routing ([997e9f4](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/997e9f43c56a119e339ba6cb723b574e393d4a8f))
* initial commit ([b68ba87](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/b68ba8796fa082168f633d14d71cfbea5353879a))
* update package dependencies and enhance security module with JWT and Passport integration ([b31c81c](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/b31c81cb3d0db69118a3e141a7a391901ffa3e0d))

### 🐛 Bug Fixes

* add @fastify/multipart as peer dependency ([0e0daf8](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/0e0daf88c8b61ab6b7b987995abc3df584e10135))
* add semantic-release deps and fix CI ([6f2a601](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/6f2a601a1bf2ad5df6b1458b16d776742bcbdfe1))
* correct base app url ([2c7636b](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/2c7636b5eea65ce9803baa62106b23225987a1b8))
* correct company configuration requirements ([aef616f](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/aef616fa63f82ee7740f5b366b391db366edf209))
* correct default language ([0f5260b](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/0f5260bfe52ef087aeb01a736765572012bfeab8))
* correct exported components and classes ([82dbed8](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/82dbed891bd8f93459f267803865baf2c313e7d8))
* correct injections and company configurations ([c00dde5](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/c00dde5f68530d1eb9595970d7af787fe6b37aa2))
* correct job processing configuration and update prompts for summarization ([57f1f23](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/57f1f23069bdbe53061b5f3285e46aceadfec275))
* correct migration tool with CLI updates and configuration adjustments ([c8c96ca](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/c8c96ca924d3a2e63ee60796ab0d7c9a1dabfc7c))
* correct openrouter embedders ([4051599](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/4051599ffc35ad124676d822d66f01a13f04dd05))
* correct queue names ([b4fcc7c](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/b4fcc7c290258469257ac734f4de1e89633cb216))
* correct queue names ([1cbab76](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/1cbab7646608d385fe6cfcfe497d27518e7142da))
* remove AppModeModule from core modules to avoid errors in worker ([878677e](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/878677e79b27d98b8011397056e8c3bf532d46e0))
* remove company configurations ([83011d5](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/83011d5656c836d2f21600d5a3704af7493933bf))
* remove console logs ([481f935](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/481f9351d99de196e3de8f6c4a0309baf9008b90))
* remove unused code ([e53d925](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/e53d9253a57b9544f12f9d56b4017aabaece80dd))
* remove unused file ([42de897](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/42de897814dad9677474c028f4061b0165455aa8))
* update dependencies to latest stable versions ([3a784ae](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/3a784aeb780f0ed938bd81085ff635b3b434bda5))
* update migrator service to stable version ([0da5ed3](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/0da5ed31389bf534cde460271b10d32d91af88b9))
* update queue injection to use QueueId enum ([46e3c85](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/46e3c854b3149b6b16c6229f431f549f861a1c17))

### 📚 Documentation

* add git submodule setup instructions to README ([8773809](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/8773809ca7202ebb3ee35a62c8288af7d960639f))
* update README ([56801f0](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/56801f052c0530e5c0453a918f69a19f41c5a71c))
* update readme to new CompanyConfiguration requirements ([26c2911](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/26c29118a678a97e8b255f5bef380710efea4524))

### 📦 Code Refactoring

* reorder exports in foundations index for improved readability ([2f470c6](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/2f470c6d2003f0df642bd233c54e7d37d8abd2b2))
* update configuration handling across services and modules ([f5743e7](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/f5743e7186669360c6fe0e8c538cec27d8f6eb4a))
* update default prompts for ai agents ([eb5f6e1](https://github.com/carlonicora/nestjs-neo4jsonapi/commit/eb5f6e185ba99772107d2d108ea2fd5c5b43b12f))

# Changelog
