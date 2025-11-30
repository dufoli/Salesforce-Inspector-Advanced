/* global */

/**
 * Module to generate SOQL queries using AI (ChatGPT, Mistral, Claude)
 */

export class AIQueryGenerator {
  constructor() {
    this.providers = {
      openai: {
        name: "OpenAI (ChatGPT)",
        endpoint: "https://api.openai.com/v1/chat/completions",
        model: "gpt-4o-mini"
      },
      mistral: {
        name: "Mistral AI",
        endpoint: "https://api.mistral.ai/v1/chat/completions",
        model: "mistral-small"
      },
      anthropic: {
        name: "Anthropic (Claude)",
        endpoint: "https://api.anthropic.com/v1/messages",
        model: "claude-3-5-sonnet-20241022"
      }
    };
  }

  /**
   * Generates a SOQL query based on a natural language description
   * @param {string} description - Natural language description of what the user wants
   * @param {string} provider - AI provider: 'openai', 'mistral', 'anthropic'
   * @param {string} apiKey - Provider API key
   * @param {Object} context - Additional context (available Salesforce objects, describeInfo, etc.)
   * @returns {Promise<string>} - The generated SOQL query
   */
  async generateSOQL(description, provider, apiKey, context = {}) {
    if (!apiKey || apiKey.trim() === "") {
      throw new Error("API key not configured. Please configure your API key in the options.");
    }

    if (!this.providers[provider]) {
      throw new Error(`Unrecognized AI provider: ${provider}`);
    }

    const providerConfig = this.providers[provider];

    // Step 1: Identify relevant custom objects using AI (RAG step 1)
    let ragContext = {};
    if (context.describeInfo) {
      try {
        ragContext = await this.buildRAGContext(description, provider, apiKey, context.describeInfo);
      } catch (error) {
        console.warn("RAG context building failed, continuing without it:", error);
        // Continue without RAG if it fails
      }
    }

    // Step 2: Build prompt with RAG context and generate SOQL
    const enhancedContext = {
      ...context,
      ...ragContext
    };
    const prompt = this.buildPrompt(description, enhancedContext);

    try {
      if (provider === "openai" || provider === "mistral") {
        return await this.callOpenAICompatibleAPI(providerConfig, apiKey, prompt);
      } else if (provider === "anthropic") {
        return await this.callAnthropicAPI(providerConfig, apiKey, prompt);
      }
      throw new Error(`Unsupported AI provider: ${provider}`);
    } catch (error) {
      console.error("Error generating SOQL:", error);
      throw new Error(`Generation error: ${error.message}`);
    }
  }

  /**
   * Builds RAG context by identifying relevant custom objects and their fields
   * @param {string} description - Natural language description
   * @param {string} provider - AI provider
   * @param {string} apiKey - Provider API key
   * @param {Object} describeInfo - DescribeInfo instance to access Salesforce metadata
   * @returns {Promise<Object>} - RAG context with custom objects and fields
   */
  async buildRAGContext(description, provider, apiKey, describeInfo) {
    // Get all custom objects
    const {globalDescribe, globalStatus} = describeInfo.describeGlobal(false);
    if (globalStatus !== "ready" || !globalDescribe) {
      return {};
    }

    // Filter for custom objects only (ending with __c)
    const customObjects = globalDescribe.sobjects
      .filter(obj => obj.name.endsWith("__c") && obj.associateEntityType == null)
      .map(obj => ({
        name: obj.name,
        label: obj.label || obj.name
      }));

    if (customObjects.length === 0) {
      return {};
    }

    // Step 1: Use AI to identify relevant custom objects
    const relevantObjectNames = await this.identifyRelevantObjects(
      description,
      customObjects,
      describeInfo,
      provider,
      apiKey
    );

    if (relevantObjectNames.length === 0) {
      return {};
    }

    // Step 2: Get custom fields for the relevant objects
    const customObjectsWithFields = await this.getCustomFieldsForObjects(
      relevantObjectNames,
      describeInfo
    );

    return {
      customObjects: customObjectsWithFields
    };
  }

  /**
   * Identifies relevant custom objects from the description using AI
   * @param {string} description - Natural language description
   * @param {Array} customObjects - List of custom objects
   * @param {string} provider - AI provider
   * @param {string} apiKey - Provider API key
   * @returns {Promise<Array<string>>} - Array of relevant object API names
   */
  async identifyRelevantObjects(description, customObjects, describeInfo, provider, apiKey) {
    // Limit to first 200 objects to avoid token limits
    const objectsList = customObjects.slice(0, 200)
      .map(obj => `${obj.name} (${obj.label})`)
      .join(", ");

    const prompt = `You are analyzing a Salesforce SOQL query request. Based on the following description, identify which CUSTOM objects (ending with __c) and standard objects (Account, Contact, etc.) are likely to be relevant.

Description: ${description}

Available custom objects:
${objectsList}

Instructions:
- Return ONLY a comma-separated list of object API names (e.g., "Account", "CustomObject1__c, CustomObject2__c")
- Only include objects that are clearly relevant to the query description
- If no objects are relevant, return an empty string
- Return ONLY the object names, nothing else`;

    const providerConfig = this.providers[provider];
    let response;

    try {
      if (provider === "openai" || provider === "mistral") {
        response = await this.callOpenAICompatibleAPI(providerConfig, apiKey, prompt, true);
      } else if (provider === "anthropic") {
        response = await this.callAnthropicAPI(providerConfig, apiKey, prompt, true);
      } else {
        return [];
      }

      // Parse the response to extract object names
      const objectNames = response
        .split(",")
        .map(name => name.trim())
        .filter(name => name.length > 3);

      // Validate that these objects exist in our list
      // const validObjectNames = objectNames.filter(name =>
      //   customObjects.some(obj => obj.name === name)
      // );
      const validObjectNames = objectNames.filter(name =>
        describeInfo.describeGlobal(false).globalDescribe.sobjects.some(obj => obj.name === name));

      return validObjectNames.slice(0, 10); // Limit to 10 objects
    } catch (error) {
      console.warn("Error identifying relevant objects:", error);
      return [];
    }
  }

  /**
   * Gets custom fields for the specified objects
   * @param {Array<string>} objectNames - Array of object API names
   * @param {Object} describeInfo - DescribeInfo instance
   * @returns {Promise<Array>} - Array of objects with their custom fields
   */
  async getCustomFieldsForObjects(objectNames, describeInfo) {
    const objectsWithFields = [];
    const maxWaitTime = 3000; // 3 seconds max wait per object

    for (const objectName of objectNames) {
      try {
        // Use callback to wait for describe to complete
        await new Promise((resolve) => {
          const startTime = Date.now();
          let resolved = false;

          const checkDescribe = () => {
            const {sobjectDescribe, sobjectStatus} = describeInfo.describeSobject(false, objectName);

            if (sobjectStatus === "ready" && sobjectDescribe) {
              if (!resolved) {
                resolved = true;
                // Filter for custom fields only (ending with __c)
                const customFields = sobjectDescribe.fields
                  .filter(field => field.name.endsWith("__c"))
                  .map(field => ({
                    name: field.name,
                    label: field.label || field.name,
                    type: field.type,
                    referenceTo: field.referenceTo || []
                  }));

                if (customFields.length > 0) {
                  objectsWithFields.push({
                    name: objectName,
                    label: sobjectDescribe.label || objectName,
                    fields: customFields.slice(0, 100) // Limit to 100 fields per object
                  });
                }
                resolve();
              }
              return;
            }
            if (sobjectStatus === "pending" || sobjectStatus === "loading") {
              // Wait a bit and check again, or use callback if available
              if (Date.now() - startTime < maxWaitTime) {
                setTimeout(checkDescribe, 200);
              } else if (!resolved) {
                resolved = true;
                resolve(); // Timeout, skip this object
              }
              return;
            }
            // notfound or loadfailed
            if (!resolved) {
              resolved = true;
              resolve(); // Skip this object
            }
          };

          // Use callback if describeInfo supports it
          describeInfo.describeSobject(false, objectName, (describe) => {
            if (describe && !resolved) {
              resolved = true;
              const customFields = describe.fields
                .filter(field => field.name.endsWith("__c"))
                .map(field => ({
                  name: field.name,
                  label: field.label || field.name,
                  type: field.type,
                  referenceTo: field.referenceTo || []
                }));

              if (customFields.length > 0) {
                objectsWithFields.push({
                  name: objectName,
                  label: describe.label || objectName,
                  fields: customFields.slice(0, 100)
                });
              }
              resolve();
            }
          });

          // Also start polling in case callback doesn't fire
          checkDescribe();
        });
      } catch (error) {
        console.warn(`Error getting fields for ${objectName}:`, error);
        // Continue with other objects
      }
    }

    return objectsWithFields;
  }

  /**
   * Builds the prompt for the AI
   */
  buildPrompt(description, context) {
    let prompt = `You are a Salesforce SOQL expert. Generate a valid SOQL query based on the following description.

Description: ${description}

Instructions:
- Generate ONLY the SOQL query, without explanation, without comments, without markdown code
- Use standard Salesforce SOQL syntax
- Include essential fields (Id, Name, etc.) if not specified
- Make sure the query is syntactically correct
- If specific objects or fields are mentioned, use them exactly
`;

    // Add RAG context with custom objects and fields
    if (context.customObjects && context.customObjects.length > 0) {
      prompt += "\n\nRelevant Custom Objects and Fields:\n";
      context.customObjects.forEach(obj => {
        prompt += `\nObject: ${obj.name} (${obj.label})\n`;
        prompt += "Custom Fields:\n";
        obj.fields.forEach(field => {
          prompt += `  - ${field.name} (${field.label}) - Type: ${field.type}`;
          if (field.referenceTo && field.referenceTo.length > 0) {
            prompt += ` - References: ${field.referenceTo.join(", ")}`;
          }
          prompt += "\n";
        });
      });
    }

    if (context.availableObjects && context.availableObjects.length > 0) {
      prompt += "\n\nOther Available Salesforce objects (use exact API names):\n";
      context.availableObjects.slice(0, 50).forEach(obj => {
        prompt += `- ${obj.name} (${obj.label})\n`;
      });
    }

    if (context.currentQuery) {
      prompt += `\nCurrent query (can you improve or modify it):\n${context.currentQuery}\n`;
    }

    prompt += "\nRespond ONLY with the SOQL query, nothing else.";

    return prompt;
  }

  /**
   * Calls the OpenAI or Mistral API (compatible format)
   * Uses the background script to avoid CORS issues
   * @param {Object} providerConfig - Provider configuration
   * @param {string} apiKey - API key
   * @param {string} prompt - Prompt to send
   * @param {boolean} isObjectIdentification - If true, uses different system message for object identification
   */
  async callOpenAICompatibleAPI(providerConfig, apiKey, prompt, isObjectIdentification = false) {
    let currentBrowser;
    if (typeof browser === "undefined") {
      currentBrowser = chrome;
    } else {
      currentBrowser = browser;
    }

    const systemMessage = isObjectIdentification
      ? "You are a Salesforce metadata expert. You identify relevant Salesforce custom objects based on query descriptions. Return only object names."
      : "You are a Salesforce SOQL expert. You generate only valid SOQL queries, without explanation.";

    const body = {
      model: providerConfig.model,
      messages: [
        {
          role: "system",
          content: systemMessage
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      // eslint-disable-next-line camelcase
      max_tokens: isObjectIdentification ? 200 : 500
    };

    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    };

    return new Promise((resolve, reject) => {
      currentBrowser.runtime.sendMessage({
        message: "callAIAPI",
        endpoint: providerConfig.endpoint,
        body,
        headers
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response || !response.success) {
          reject(new Error(response?.error || "API call error"));
          return;
        }

        const data = response.data;
        let result = data.choices?.[0]?.message?.content?.trim() || "";

        // Clean the response (remove markdown code blocks if present)
        result = result.replace(/```soql\n?/gi, "").replace(/```sql\n?/gi, "").replace(/```\n?/g, "").trim();

        if (!result) {
          reject(new Error(isObjectIdentification ? "No objects identified by AI" : "No SOQL query generated by AI"));
          return;
        }

        resolve(result);
      });
    });
  }

  /**
   * Calls the Anthropic API (Claude)
   * Uses the background script to avoid CORS issues
   * @param {Object} providerConfig - Provider configuration
   * @param {string} apiKey - API key
   * @param {string} prompt - Prompt to send
   * @param {boolean} isObjectIdentification - If true, uses different system message for object identification
   */
  async callAnthropicAPI(providerConfig, apiKey, prompt, isObjectIdentification = false) {
    let currentBrowser;
    if (typeof browser === "undefined") {
      currentBrowser = chrome;
    } else {
      currentBrowser = browser;
    }

    const systemMessage = isObjectIdentification
      ? "You are a Salesforce metadata expert. You identify relevant Salesforce custom objects based on query descriptions. Return only object names."
      : "You are a Salesforce SOQL expert. You generate only valid SOQL queries, without explanation.";

    const body = {
      model: providerConfig.model,
      // eslint-disable-next-line camelcase
      max_tokens: isObjectIdentification ? 200 : 500,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      system: systemMessage
    };

    const headers = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    };

    return new Promise((resolve, reject) => {
      currentBrowser.runtime.sendMessage({
        message: "callAIAPI",
        endpoint: providerConfig.endpoint,
        body,
        headers
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response || !response.success) {
          reject(new Error(response?.error || "API call error"));
          return;
        }

        const data = response.data;
        let result = data.content?.[0]?.text?.trim() || "";

        // Clean the response
        result = result.replace(/```soql\n?/gi, "").replace(/```sql\n?/gi, "").replace(/```\n?/g, "").trim();

        if (!result) {
          reject(new Error(isObjectIdentification ? "No objects identified by AI" : "No SOQL query generated by AI"));
          return;
        }

        resolve(result);
      });
    });
  }

  /**
   * Validates that an API key is configured for a provider
   */
  isConfigured(provider) {
    const apiKey = localStorage.getItem(`aiProvider_${provider}_apiKey`);
    return apiKey && apiKey.trim() !== "";
  }

  /**
   * Gets the list of available providers
   */
  getAvailableProviders() {
    return Object.keys(this.providers).map(key => ({
      key,
      name: this.providers[key].name
    }));
  }
}

