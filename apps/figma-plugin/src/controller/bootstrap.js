figma.showUI(__html__, {
  width: 300,
  height: 780,
  themeColors: true,
});

const memberSessionStorageKey = "brand-style-member-session";

function createControllerIssueId() {
  return `issue_${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

