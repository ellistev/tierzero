/**
 * Layout variants for the ticket app.
 * v1: Standard layout
 * v2: Redesigned layout with different DOM structure, class names, and element placement
 */

export function getLayout(version: "v1" | "v2") {
  return version === "v2" ? layoutV2 : layoutV1;
}

// ---------------------------------------------------------------------------
// Layout V1 - Standard
// ---------------------------------------------------------------------------

const layoutV1 = {
  css: `
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
    .header { background: #2c3e50; color: white; padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { margin: 0; font-size: 20px; }
    .nav { display: flex; gap: 16px; }
    .nav a { color: white; text-decoration: none; }
    .container { max-width: 1000px; margin: 24px auto; padding: 0 16px; }
    .card { background: white; border-radius: 8px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .btn { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
    .btn-primary { background: #3498db; color: white; }
    .btn-danger { background: #e74c3c; color: white; }
    .btn-success { background: #27ae60; color: white; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f8f9fa; font-weight: 600; }
    tr:hover { background: #f0f7ff; }
    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; margin-bottom: 4px; font-weight: 500; }
    .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
    .form-group textarea { height: 80px; resize: vertical; }
    .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
    .badge { padding: 3px 8px; border-radius: 12px; font-size: 12px; font-weight: 500; }
    .badge-open { background: #e8f4f8; color: #2980b9; }
    .badge-in_progress { background: #fef3e2; color: #e67e22; }
    .badge-resolved { background: #e8f8f0; color: #27ae60; }
    .badge-closed { background: #f0f0f0; color: #666; }
    .badge-critical { background: #fde8e8; color: #c0392b; }
    .badge-high { background: #fef3e2; color: #e67e22; }
    .badge-medium { background: #fef9e7; color: #f39c12; }
    .badge-low { background: #e8f8f0; color: #27ae60; }
    .comment { border-left: 3px solid #3498db; padding: 8px 12px; margin: 8px 0; background: #f8f9fa; }
    .comment-author { font-weight: 600; }
    .comment-date { color: #888; font-size: 12px; }
    .search-box { display: flex; gap: 8px; margin-bottom: 16px; }
    .search-box input { flex: 1; }
    .modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 100; align-items: center; justify-content: center; }
    .modal-overlay.active { display: flex; }
    .modal { background: white; border-radius: 8px; padding: 24px; min-width: 300px; }
    .modal h3 { margin-top: 0; }
    .ticket-link { color: #3498db; text-decoration: none; cursor: pointer; }
    .ticket-link:hover { text-decoration: underline; }
    .error-page { text-align: center; padding: 60px 20px; }
    .error-page h1 { font-size: 48px; color: #e74c3c; }
  `,

  // Table column order for dashboard
  tableColumns: ["ID", "Title", "Status", "Priority", "Assignee"],
  tableFields: ["id", "title", "status", "priority", "assignee"] as const,

  // Button labels
  resolveButton: "Resolve",
  saveButton: "Save Changes",
  loginButton: "Sign In",
  searchButton: "Search",
  addCommentButton: "Add Comment",
  confirmButton: "Confirm",
  cancelButton: "Cancel",

  // Class names
  containerClass: "container",
  cardClass: "card",
  actionsClass: "actions",
  headerClass: "header",

  // Element structure
  useIcons: false,
  confirmModal: false,
};

// ---------------------------------------------------------------------------
// Layout V2 - Redesigned with different DOM structure
// ---------------------------------------------------------------------------

const layoutV2 = {
  css: `
    body { font-family: 'Segoe UI', Tahoma, sans-serif; margin: 0; padding: 0; background: #eef2f7; }
    .top-bar { background: linear-gradient(135deg, #1a1a2e, #16213e); color: white; padding: 16px 32px; }
    .top-bar h1 { margin: 0 0 8px 0; font-size: 22px; }
    .toolbar { display: flex; gap: 12px; margin-bottom: 8px; }
    .toolbar a { color: #a8d8ea; text-decoration: none; font-size: 14px; }
    .main-content { max-width: 1100px; margin: 20px auto; padding: 0 20px; }
    .panel { background: white; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .action-btn { padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; display: inline-flex; align-items: center; gap: 6px; }
    .action-btn-primary { background: #4361ee; color: white; }
    .action-btn-danger { background: #ef476f; color: white; }
    .action-btn-success { background: #06d6a0; color: white; }
    .data-grid { width: 100%; border-collapse: separate; border-spacing: 0; }
    .data-grid th { padding: 12px 16px; text-align: left; background: #f7f9fc; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
    .data-grid td { padding: 12px 16px; border-bottom: 1px solid #f0f0f0; }
    .data-grid tr:hover { background: #f7f9fc; }
    .field-group { margin-bottom: 20px; }
    .field-group label { display: block; margin-bottom: 6px; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.3px; color: #555; }
    .field-group input, .field-group select, .field-group textarea { width: 100%; padding: 10px 12px; border: 2px solid #e0e0e0; border-radius: 8px; box-sizing: border-box; font-size: 14px; }
    .field-group textarea { height: 100px; resize: vertical; }
    .field-group input:focus, .field-group select:focus, .field-group textarea:focus { border-color: #4361ee; outline: none; }
    .button-bar { display: flex; gap: 10px; margin-bottom: 20px; }
    .tag { padding: 4px 10px; border-radius: 16px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
    .tag-open { background: #dbeafe; color: #1d4ed8; }
    .tag-in_progress { background: #fef3c7; color: #b45309; }
    .tag-resolved { background: #d1fae5; color: #065f46; }
    .tag-closed { background: #e5e7eb; color: #4b5563; }
    .tag-critical { background: #fee2e2; color: #991b1b; }
    .tag-high { background: #fef3c7; color: #b45309; }
    .tag-medium { background: #fef9c3; color: #a16207; }
    .tag-low { background: #d1fae5; color: #065f46; }
    .note { border-left: 4px solid #4361ee; padding: 12px 16px; margin: 10px 0; background: #f7f9fc; border-radius: 0 8px 8px 0; }
    .note-author { font-weight: 700; color: #1a1a2e; }
    .note-date { color: #999; font-size: 11px; }
    .search-area { display: flex; gap: 10px; margin-bottom: 20px; }
    .search-area input { flex: 1; }
    .confirm-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); z-index: 100; align-items: center; justify-content: center; }
    .confirm-overlay.active { display: flex; }
    .confirm-dialog { background: white; border-radius: 12px; padding: 28px; min-width: 340px; }
    .confirm-dialog h3 { margin-top: 0; color: #1a1a2e; }
    .ticket-ref { color: #4361ee; text-decoration: none; cursor: pointer; font-weight: 500; }
    .ticket-ref:hover { text-decoration: underline; }
    .error-view { text-align: center; padding: 80px 20px; }
    .error-view h1 { font-size: 56px; color: #ef476f; }
  `,

  // Table column order REORDERED for v2
  tableColumns: ["Priority", "ID", "Title", "Assignee", "Status"],
  tableFields: ["priority", "id", "title", "assignee", "status"] as const,

  // Button labels - ICONS instead of text for v2
  resolveButton: "✓ Done",
  saveButton: "💾 Save",
  loginButton: "→ Enter",
  searchButton: "🔍",
  addCommentButton: "💬 Comment",
  confirmButton: "Yes, proceed",
  cancelButton: "No, go back",

  // Class names - ALL DIFFERENT
  containerClass: "main-content",
  cardClass: "panel",
  actionsClass: "button-bar",
  headerClass: "top-bar",

  // Element structure
  useIcons: true,
  confirmModal: true,  // v2 adds a confirmation modal on resolve
};

export type LayoutConfig = typeof layoutV1;
