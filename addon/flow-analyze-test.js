/* eslint quotes: ["error", "single", {"avoidEscape": true}] */
export async function flowAnalyzeTest(test) {
  console.log('TEST flowAnalyze');
  let {assert, loadPage} = test;

  // Load flow-analyze.html to get the Model class
  let {Model} = await loadPage('flow-analyze.html');

  // Create a test model instance
  class TestModel extends Model {
    constructor() {
      super({sfHost: 'test', args: new URLSearchParams()});
      this.flowVersionCount = 0;
    }

    // Override loadFlowMetadata to prevent actual API calls
    async loadFlowMetadata() {
      // Do nothing in tests
    }
  }

  const testModel = new TestModel();

  // Helper function to analyze flow
  function analyzeFlow(flow, flowVersionCount = 0) {
    testModel.flowVersionCount = flowVersionCount;
    return testModel.analyzeFlow(flow);
  }

  // Helper function to parse XML flow metadata
  function parseFlowMetadata(xmlString, filePath) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

    // Check for parsing errors
    const parserError = xmlDoc.querySelector('parsererror');
    if (parserError) {
      throw new Error('XML parsing error: ' + parserError.textContent);
    }

    // Convert XML to JavaScript object structure similar to Salesforce API response
    function xmlToObject(node) {
      if (node.nodeType === 3) { // Text node
        return node.textContent.trim();
      }

      const obj = {};
      const children = Array.from(node.childNodes);

      // Handle text content
      const textContent = children.filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('').trim();
      if (textContent && children.length === 1 && children[0].nodeType === 3) {
        return textContent;
      }

      // Handle child elements
      children.filter(n => n.nodeType === 1).forEach(child => {
        const childName = child.nodeName;
        const childValue = xmlToObject(child);

        if (obj[childName]) {
          // Convert to array if multiple elements with same name
          if (!Array.isArray(obj[childName])) {
            obj[childName] = [obj[childName]];
          }
          obj[childName].push(childValue);
        } else {
          obj[childName] = childValue;
        }
      });

      // Add attributes
      Array.from(node.attributes || []).forEach(attr => {
        obj[attr.name] = attr.value;
      });

      return Object.keys(obj).length > 0 ? obj : textContent || null;
    }

    const root = xmlDoc.documentElement;
    const metadata = xmlToObject(root);

    // Extract fullName from label or use default
    // testing/Unsafe_Running_Context.flow-meta.xml => Unsafe_Running_Context
    const fullName = filePath.substring(filePath.lastIndexOf('/') + 1).replace('.flow-meta.xml', '');

    return {
      FullName: fullName,
      MasterLabel: metadata.label || 'Test Flow',
      ApiVersion: metadata.apiVersion,
      Status: 'Active',
      Metadata: metadata
    };
  }

  // Helper function to load XML file
  async function loadFlowMetadata(filePath) {
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Failed to load ${filePath}: ${response.statusText}`);
    }
    const xmlText = await response.text();
    return parseFlowMetadata(xmlText, filePath);
  }

  //TODO missing tests : Flow with too many versions
  // Action Calls In Loop

  // Map XML files to expected rules based on filename
  // Files with "Fixed" in the name should NOT have the corresponding rule
  // Files without "Fixed" SHOULD have the corresponding rule
  const testFiles = [
    // Hardcoded URL
    {file: 'testing/Hardcoded_Url.flow-meta.xml', expectedRules: ['Hardcoded URL'], shouldNotHave: []},
    // Hardcoded ID
    {file: 'testing/Hardcoded_Id.flow-meta.xml', expectedRules: ['Hardcoded ID in code instead of label'], shouldNotHave: []},
    {file: 'testing/Hardcoded_Id_Fixed.flow-meta.xml', expectedRules: [], shouldNotHave: ['Hardcoded ID in code instead of label']},
    // Old API Version
    {file: 'testing/Old_API_version.flow-meta.xml', expectedRules: ['Flow old API version'], shouldNotHave: []},
    {file: 'testing/Old_API_version_Fixed.flow-meta.xml', expectedRules: [], shouldNotHave: ['Flow old API version']},
    // Get record in Loop
    {file: 'testing/Get_Record_In_A_Loop.flow-meta.xml', expectedRules: ['Get Record in Loop'], shouldNotHave: []},
    {file: 'testing/Get_Record_In_A_Loop_Fixed.flow-meta.xml', expectedRules: [], shouldNotHave: ['Get Record in Loop']},
    // Create Record in Loop
    {file: 'testing/Create_Record_In_A_Loop.flow-meta.xml', expectedRules: ['Create Record in Loop'], shouldNotHave: []},
    // Get Record All Fields
    {file: 'testing/Get_All_Elements_Flow_ALL_FIELDS.flow-meta.xml', expectedRules: ['Get Record All Fields'], shouldNotHave: []},
    // Unsafe Running Context
    {file: 'testing/Unsafe_Running_Context.flow-meta.xml', expectedRules: ['Unsafe Running Context'], shouldNotHave: []},
    {file: 'testing/Unsafe_Running_Context_Default.flow-meta.xml', expectedRules: [], shouldNotHave: ['Unsafe Running Context']},
    {file: 'testing/Unsafe_Running_Context_WithSharing.flow-meta.xml', expectedRules: [], shouldNotHave: ['Unsafe Running Context']},
    // Unused Variable
    {file: 'testing/Unused_Variable.flow-meta.xml', expectedRules: ['Unused Variable'], shouldNotHave: []},
    {file: 'testing/Unused_Variable_Fixed.flow-meta.xml', expectedRules: [], shouldNotHave: ['Unused Variable']},
    // Same Record Field Updates
    {file: 'testing/Same_Record_Field_Updates.flow-meta.xml', expectedRules: ['Same Record Field Updates'], shouldNotHave: []},
    // Copy API Name
    {file: 'testing/Copy_API_Name.flow-meta.xml', expectedRules: ['Copy API Name'], shouldNotHave: []},
    {file: 'testing/Copy_API_Name_Fixed.flow-meta.xml', expectedRules: [], shouldNotHave: ['Copy API Name']},
    // Flow Naming Convention
    {file: 'testing/FlowNamingConvention.flow-meta.xml', expectedRules: ['Flow Naming Convention'], shouldNotHave: []},
    {file: 'testing/Flow_Naming_Convention_Fixed.flow-meta.xml', expectedRules: [], shouldNotHave: ['Flow Naming Convention']},
    // Missing Error Handler
    {file: 'testing/Missing_Fault_Path.flow-meta.xml', expectedRules: ['Missing fault path'], shouldNotHave: []},
    {file: 'testing/Missing_Fault_Path_Fixed.flow-meta.xml', expectedRules: [], shouldNotHave: ['Missing fault path']},
    // Missing Null Handler
    {file: 'testing/Missing_Null_Handler.flow-meta.xml', expectedRules: ['Missing null handler'], shouldNotHave: []},
    {file: 'testing/Missing_Null_Handler_Fixed.flow-meta.xml', expectedRules: [], shouldNotHave: ['Missing null handler']},
    {file: 'testing/No_Missing_Null_Handler.flow-meta.xml', expectedRules: ['Missing null handler'], shouldNotHave: []},
    // Recursive after update
    {file: 'testing/Recursive_After_Update.flow-meta.xml', expectedRules: ['Recursive after update'], shouldNotHave: []},
    // Unconnected Element
    {file: 'testing/Unconnected_Element.flow-meta.xml', expectedRules: ['Unconnected Element'], shouldNotHave: []},
    {file: 'testing/Unconnected_Element_Fixed.flow-meta.xml', expectedRules: [], shouldNotHave: ['Unconnected Element']},
    {file: 'testing/Unconnected_Element_Async.flow-meta.xml', expectedRules: ['Unconnected Element'], shouldNotHave: []},
    // Cyclomatic Complexity
    {file: 'testing/Cyclomatic_Complexity.flow-meta.xml', expectedRules: ['Cyclomatic Complexity'], shouldNotHave: []},
    // Missing Flow Description
    {file: 'testing/Missing_Flow_Description.flow-meta.xml', expectedRules: ['Missing Flow Description'], shouldNotHave: []},
    {file: 'testing/Missing_Flow_Description_Fixed.flow-meta.xml', expectedRules: [], shouldNotHave: ['Missing Flow Description']}
  ];

  // Test all XML files
  for (const testFile of testFiles) {
    try {
      console.log(`Testing with XML file: ${testFile.file}`);
      const testFlow = await loadFlowMetadata(testFile.file);
      const results = analyzeFlow(testFlow);
      const foundRules = results.map(r => r.rule);
      console.log(`  Found ${results.length} issue(s):`, foundRules.join(', ') || 'none');

      // Check expected rules are present
      for (const expectedRule of testFile.expectedRules) {
        assert(foundRules.includes(expectedRule),
          `Expected rule "${expectedRule}" not found in ${testFile.file}. Found: ${foundRules.join(', ') || 'none'}`);
      }

      // Check that rules that should NOT be present are absent
      for (const ruleNotExpected of testFile.shouldNotHave) {
        assert(!foundRules.includes(ruleNotExpected),
          `File ${testFile.file} should NOT have rule "${ruleNotExpected}" but it was found. Found: ${foundRules.join(', ')}`);
      }
    } catch (e) {
      console.error(`  Error testing ${testFile.file}:`, e.message);
      throw e; // Fail the test if we can't load a file
    }
  }

  console.log('All flow analyzer tests passed');
}
