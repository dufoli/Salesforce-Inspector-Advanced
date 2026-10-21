export async function popupTest(test) {
  console.log("TEST popup");
  let {assertEquals, loadPage} = test;
  let {getRecordId} = await loadPage("test-page.html");
  // Classic & Console
  assertEquals("001i0000007BlV0", getRecordId(new URL("https://na1.salesforce.com/001i0000007BlV0"))); // classic record detail page
  assertEquals("001i0000007BlV0", getRecordId(new URL("https://cs81.salesforce.com/001i0000007BlV0"))); // in sandbox
  assertEquals("001i0000007BlV0AAK", getRecordId(new URL("https://na1.salesforce.com/001i0000007BlV0AAK"))); // with 18 character ID
  assertEquals("001i0000007BlV0", getRecordId(new URL("https://mydomain.my.salesforce.com/001i0000007BlV0"))); // using My Domain
  assertEquals("001i0000007BlV0", getRecordId(new URL("https://mydomain--sandbox.cs81.my.salesforce.com/001i0000007BlV0"))); // using My Domain in sandbox
  assertEquals("001i0000007BlV0", getRecordId(new URL("https://na1.salesforce.com/001i0000007BlV0/e?retURL=xyz"))); // classic record edit page
  assertEquals("005i0000000Eths", getRecordId(new URL("https://na1.salesforce.com/_ui/core/userprofile/UserProfilePage?u=005i0000000Eths&tab=sfdc.ProfilePlatformFeed"))); // user profile page
  assertEquals("005i0000000Eths", getRecordId(new URL("https://na1.salesforce.com/005i0000000Eths?noredirect=1&isUserEntityOverride=1"))); // user detail page
  assertEquals("0Afi000000STGOj", getRecordId(new URL("https://na1.salesforce.com/changemgmt/monitorDeploymentsDetails.apexp?retURL=/changemgmt/monitorDeployment.apexp&asyncId=0Afi000000STGOj")));
  assertEquals(null, getRecordId(new URL("https://na1.salesforce.com/home/home.jsp"))); // no ID
  assertEquals(null, getRecordId(new URL("https://na1.salesforce.com/foofoofoofoofoo"))); // 15 character non-ID
  assertEquals("001", getRecordId(new URL("https://na1.salesforce.com/001/o"))); // record home
  assertEquals("001i0000007BlV0AAK", getRecordId(new URL("https://na1.salesforce.com/001i0000007BlV0AAK?id=a37E0000000DV1c"))); // prefer standard
  // Visualforce
  assertEquals("001i0000007BlV0", getRecordId(new URL("https://na1.visual.force.com/apex/VfPage?id=001i0000007BlV0"))); // visualforce
  assertEquals("001i0000007BlV0AAK", getRecordId(new URL("https://na1.visual.force.com/apex/VfPage?id=001i0000007BlV0AAK"))); // visualforce with 18 character ID
  assertEquals("001i0000007BlV0", getRecordId(new URL("https://na1.visual.force.com/apex/VfPage?scontrolCaching=1&id=001i0000007BlV0&retURL=xyz"))); // visualforce with other parameters
  assertEquals("001i0000007BlV0", getRecordId(new URL("https://mydomain--c.na1.visual.force.com/apex/VfPage?id=001i0000007BlV0"))); // visualforce with My Domain
  assertEquals("a37E0000000DV1c", getRecordId(new URL("https://bmcservicedesk.na9.visual.force.com/apex/RemedyforceConsole?record_id=a37E0000000DV1c&objectName=Incident__c&inctype=Incident#false"))); // visuflforce page with non-standard parameter name
  assertEquals("001i0000007BlV0", getRecordId(new URL("https://na1.visual.force.com/apex/VfPage?id=001i0000007BlV0&other=a37E0000000DV1c"))); // prefer standard parameter name
  assertEquals("a37E0000000DV1c", getRecordId(new URL("https://na1.visual.force.com/apex/VfPage?other=001i0000007BlV0&id=a37E0000000DV1c"))); // prefer standard parameter name
  assertEquals("001i0000007BlV0", getRecordId(new URL("https://na1.visual.force.com/apex/VfPage?other=001i0000007BlV0"))); // another non-standard name
  assertEquals(null, getRecordId(new URL("https://na1.visual.force.com/apex/VfPage?other=foo"))); // parameter containing 3 character non-ID
  assertEquals(null, getRecordId(new URL("https://na1.visual.force.com/apex/VfPage?other=foofoofoofoofoo"))); // parameter containing 15 character non-ID
  // Lightning Experience / Salesforce1 (Pre URL change: https://docs.releasenotes.salesforce.com/en-us/spring18/release-notes/rn_general_enhanced_urls_cruc.htm)
  assertEquals("Account", getRecordId(new URL("https://na1.lightning.force.com/one/one.app?source=aloha#/sObject/Account/home?t=1473700726105"))); // lightning record home
  assertEquals("Account", getRecordId(new URL("https://mydomain.lightning.force.com/one/one.app?source=aloha#/sObject/Account/home?t=1473700726105"))); // lightning record home with My Domain
  assertEquals("001i0000007BlV0AAK", getRecordId(new URL("https://na1.lightning.force.com/one/one.app?source=aloha#/sObject/001i0000007BlV0AAK/view?t=1473700726105"))); // lightning record detail page
  assertEquals("001i0000007BlV0AAK", getRecordId(new URL("https://na1.lightning.force.com/one/one.app?id=a37E0000000DV1c#/sObject/001i0000007BlV0AAK/view?t=1473700726105"))); // prefer standard
  assertEquals("a37E0000000DV1c", getRecordId(new URL("https://na1.lightning.force.com/one/one.app?id=a37E0000000DV1c#/foo?t=1473700726105"))); // support non-standard
  // Lightning Experience / Salesforce1
  assertEquals("001U0000004JEu4IAG", getRecordId(new URL("https://mydomain.lightning.force.com/lightning/r/Account/001U0000004JEu4IAG/view"))); // standard object record detail
  assertEquals("xxxU0000004JEu4IAG", getRecordId(new URL("https://mydomain.lightning.force.com/lightning/r/pack__Custom_Object1/xxxU0000004JEu4IAG/view"))); // custom object record detail
  assertEquals("001U0000004JEu4IAG", getRecordId(new URL("https://mydomain.lightning.force.com/lightning/r/001U0000004JEu4IAG/view"))); // record detail without sobject
  assertEquals("Account", getRecordId(new URL("https://mydomain.lightning.force.com/lightning/o/Account/list?filterName=Recent"))); // list view
  assertEquals("Account", getRecordId(new URL("https://mydomain.lightning.force.com/lightning/o/Account/home"))); // object home
  assertEquals(null, getRecordId(new URL("https://mydomain.lightning.force.com/lightning/page/home"))); // no ID
  assertEquals(null, getRecordId(new URL("https://mydomain.my.salesforce.com/one/one.app"))); // 3 character segment is not a key prefix
  assertEquals("001U0000004JEu4IAG", getRecordId(new URL("https://mydomain.lightning.force.com.mcas.ms/lightning/r/Account/001U0000004JEu4IAG/view"))); // MCAS proxy
  assertEquals("001U0000004JEu4IAG", getRecordId(new URL("https://mydomain.sandbox.lightning.force.com/lightning/r/Account/001U0000004JEu4IAG/view"))); // enhanced domain sandbox
  assertEquals("001U0000004JEu4IAG", getRecordId(new URL("https://mydomain.lightning.sfcrmapps.cn/lightning/r/Account/001U0000004JEu4IAG/view"))); // Hyperforce China
  assertEquals("a0B5g0AbCdEfGhI", getRecordId(new URL("https://mydomain.my.salesforce.com/a0B5g0AbCdEfGhI"))); // ID without "0000"
  assertEquals(null, getRecordId(new URL("https://mydomain.my.salesforce.com/FieldsAndRelations"))); // 18 character non-ID (bad checksum)
  // Setup
  assertEquals("01pi0000000AbCd", getRecordId(new URL("https://mydomain.my.salesforce-setup.com/lightning/setup/ApexClasses/page?address=%2F01pi0000000AbCd"))); // setup with address
  assertEquals("005i0000000Eths", getRecordId(new URL("https://mydomain.my.salesforce-setup.com/lightning/setup/ManageUsers/page?address=%2F005i0000000Eths%3Fnoredirect%3D1"))); // address with query
  assertEquals("0Afi000000STGOj", getRecordId(new URL("https://mydomain.my.salesforce-setup.com/lightning/setup/DeployStatus/page?address=%2Fchangemgmt%2FmonitorDeploymentsDetails.apexp%3FasyncId%3D0Afi000000STGOj"))); // ID inside address query
  assertEquals("00Ni0000000AbCd", getRecordId(new URL("https://mydomain.my.salesforce-setup.com/lightning/setup/ObjectManager/01Ii0000000AbCd/FieldsAndRelationships/00Ni0000000AbCd/view"))); // deepest ID wins
  assertEquals(null, getRecordId(new URL("https://mydomain.my.salesforce-setup.com/lightning/setup/SetupOneHome/home"))); // no ID
  // Flow Builder
  assertEquals("301i0000000AbCd", getRecordId(new URL("https://mydomain.lightning.force.com/builder_platform_interaction/flowBuilder.app?flowDefId=300i0000000AbCd&flowId=301i0000000AbCd"))); // prefer flow version
  // Visualforce & Experience Cloud
  assertEquals("001i0000007BlV0", getRecordId(new URL("https://mydomain--c.vf.force.com/apex/VfPage?id=001i0000007BlV0"))); // enhanced domain visualforce
  assertEquals("001i0000007BlV0", getRecordId(new URL("https://mydomain--pkg.visualforce.com/apex/VfPage?id=001i0000007BlV0"))); // visualforce.com
  assertEquals(null, getRecordId(new URL("https://na1.visual.force.com/apex/VfPage?id=foo"))); // invalid id parameter
  assertEquals("001U0000004JEu4IAG", getRecordId(new URL("https://mydomain.my.site.com/s/detail/001U0000004JEu4IAG"))); // Experience Cloud site
  assertEquals("0DMi0000000AbCd", getRecordId(new URL("https://mydomain.builder.salesforce-experience.com/sfsites/picasso/core/config/commeditor.jsp?siteId=0DMi0000000AbCd"))); // Experience Builder
}
