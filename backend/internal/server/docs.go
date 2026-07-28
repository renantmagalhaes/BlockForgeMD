package server

import (
	"net/http"
	"text/template"
)

func (s *Server) handleGetDocs(w http.ResponseWriter, r *http.Request) {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	baseURL := scheme + "://" + r.Host
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := docsTmpl.Execute(w, baseURL); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

var docsTmpl = template.Must(template.New("docs").Parse(docsHTML))

// docsHTML is the self-contained API reference page.
// {{.}} is replaced with the server's own base URL at render time.
const docsHTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BlockForgeMD · API Reference</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
:root{
  --bg:#0d1117;--surf:#161b22;--surf2:#1c2330;--border:#21262d;
  --text:#c9d1d9;--muted:#6e7681;--accent:#8b5cf6;--accent2:#60a5fa;
  --get:#10b981;--post:#3b82f6;--patch:#f59e0b;--delete:#ef4444;
  --r:6px;
  --mono:'JetBrains Mono','Cascadia Code','Fira Code',ui-monospace,monospace;
  --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
}
@media(prefers-color-scheme:light){:root{
  --bg:#f6f8fa;--surf:#fff;--surf2:#f0f2f5;--border:#d0d7de;
  --text:#24292f;--muted:#57606a;
  --get:#1a7f37;--post:#0969da;--patch:#9a6700;--delete:#cf222e;
}}
:root[data-theme="dark"]{
  --bg:#0d1117;--surf:#161b22;--surf2:#1c2330;--border:#21262d;
  --text:#c9d1d9;--muted:#6e7681;
  --get:#10b981;--post:#3b82f6;--patch:#f59e0b;--delete:#ef4444;
}
:root[data-theme="light"]{
  --bg:#f6f8fa;--surf:#fff;--surf2:#f0f2f5;--border:#d0d7de;
  --text:#24292f;--muted:#57606a;
  --get:#1a7f37;--post:#0969da;--patch:#9a6700;--delete:#cf222e;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{font-size:14px;-webkit-text-size-adjust:100%}
body{font-family:var(--sans);background:var(--bg);color:var(--text);display:flex;height:100vh;overflow:hidden}

/* ── Sidebar ── */
#sb{width:220px;min-width:220px;background:var(--surf);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden}
.sb-hd{padding:20px 16px 14px;border-bottom:1px solid var(--border)}
.sb-logo{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.logo-mark{width:28px;height:28px;border-radius:6px;background:linear-gradient(135deg,#7c3aed,#3b82f6);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:10px;color:#fff;font-family:var(--sans);flex-shrink:0;letter-spacing:.02em}
.sb-name{font-size:13px;font-weight:700;letter-spacing:-.01em}
.sb-tag{font-size:10px;color:var(--muted);font-family:var(--mono);margin-top:1px}
.sb-search{margin-top:10px}
.sb-search input{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:var(--r);padding:6px 10px;font-size:12px;color:var(--text);font-family:var(--sans);outline:none}
.sb-search input:focus{border-color:var(--accent)}
.sb-search input::placeholder{color:var(--muted)}
.cat-list{padding:10px 0;flex:1}
.cat-item{display:flex;align-items:center;justify-content:space-between;padding:7px 16px;font-size:12px;font-weight:500;cursor:pointer;color:var(--muted);border-left:2px solid transparent;text-decoration:none;transition:background .1s,color .1s,border-color .1s}
.cat-item:hover{background:var(--surf2);color:var(--text)}
.cat-item.active{background:rgba(139,92,246,.09);border-left-color:var(--accent);color:var(--text)}
.cat-badge{font-family:var(--mono);font-size:10px;background:var(--surf2);color:var(--muted);padding:1px 5px;border-radius:10px;border:1px solid var(--border)}
.sb-ft{padding:12px 16px;border-top:1px solid var(--border);font-size:10px;color:var(--muted);font-family:var(--mono)}

/* ── Main ── */
#main{flex:1;overflow-y:auto;overflow-x:hidden;scroll-behavior:smooth}
.top-bar{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--border);padding:10px 28px;display:flex;align-items:center;gap:10px;z-index:10}
.base-lbl{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-family:var(--mono);white-space:nowrap}
.base-in{font-family:var(--mono);font-size:12px;background:var(--surf);border:1px solid var(--border);border-radius:var(--r);padding:5px 10px;color:var(--text);outline:none;min-width:230px}
.base-in:focus{border-color:var(--accent)}
.docs-hint{margin-left:auto;font-size:11px;color:var(--muted)}
#content{padding:24px 28px 80px;max-width:860px}

/* ── Section ── */
.cat-sec{margin-bottom:36px}
.cat-hd{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px;display:flex;align-items:center;gap:10px}
.cat-hd::after{content:'';flex:1;height:1px;background:var(--border)}

/* ── Endpoint card ── */
.ep{background:var(--surf);border:1px solid var(--border);border-radius:var(--r);margin-bottom:5px;overflow:hidden}
.ep-hd{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;user-select:none;transition:background .1s}
.ep-hd:hover{background:var(--surf2)}
.badge{font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.06em;width:54px;text-align:center;padding:3px 0;border-radius:4px;flex-shrink:0;border-width:1px;border-style:solid}
.GET   {color:var(--get);   border-color:var(--get);   background:color-mix(in srgb,var(--get)   10%,transparent)}
.POST  {color:var(--post);  border-color:var(--post);  background:color-mix(in srgb,var(--post)  10%,transparent)}
.PATCH {color:var(--patch); border-color:var(--patch); background:color-mix(in srgb,var(--patch) 10%,transparent)}
.DELETE{color:var(--delete);border-color:var(--delete);background:color-mix(in srgb,var(--delete)10%,transparent)}
.ep-path{font-family:var(--mono);font-size:12.5px;color:var(--text)}
.ep-sum{font-size:12px;color:var(--muted);margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px;text-align:right}
.chev{margin-left:6px;color:var(--muted);flex-shrink:0;transition:transform .15s}
.ep.open .chev{transform:rotate(90deg)}
.ep-body{display:none;border-top:1px solid var(--border);padding:16px}
.ep.open .ep-body{display:block}
.ep-desc{font-size:12.5px;line-height:1.65;color:var(--muted);margin-bottom:14px;max-width:620px}

/* ── Params table ── */
.tbl-lbl{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.ptbl{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:12px}
.ptbl th{text-align:left;font-size:9.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);padding:4px 8px;border-bottom:1px solid var(--border)}
.ptbl td{padding:6px 8px;border-bottom:1px solid var(--border);vertical-align:top}
.ptbl tr:last-child td{border-bottom:none}
.pname{font-family:var(--mono);font-size:11.5px;color:var(--text)}
.ptype{font-family:var(--mono);font-size:10.5px;color:var(--accent2)}
.preq{font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--delete);padding:1px 4px;border:1px solid var(--delete);border-radius:3px}
.popt{font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);padding:1px 4px;border:1px solid var(--border);border-radius:3px}
.pdesc{color:var(--muted)}

/* ── Code blocks ── */
.code-lbl{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:12px 0 5px}
.code-lbl:first-child{margin-top:0}
.cblock{position:relative;background:var(--bg);border:1px solid var(--border);border-radius:var(--r);padding:10px 12px;overflow-x:auto}
.cblock pre{font-family:var(--mono);font-size:11.5px;line-height:1.55;color:var(--text);white-space:pre;padding-right:56px}
.prompt{color:var(--muted);-webkit-user-select:none;user-select:none}
.copy-btn{position:absolute;top:8px;right:8px;background:var(--surf);border:1px solid var(--border);color:var(--muted);font-size:10px;font-family:var(--sans);padding:3px 8px;border-radius:4px;cursor:pointer;transition:color .1s,border-color .1s;white-space:nowrap}
.copy-btn:hover{color:var(--text);border-color:var(--accent)}
.copy-btn.ok{color:var(--get);border-color:var(--get)}
.resp-block{background:var(--bg);border:1px solid var(--border);border-radius:var(--r);padding:10px 12px;font-family:var(--mono);font-size:11.5px;line-height:1.6;overflow-x:auto;max-height:180px;overflow-y:auto;color:var(--text)}
.hidden{display:none!important}
</style>
</head>
<body>

<div id="sb">
  <div class="sb-hd">
    <div class="sb-logo">
      <div class="logo-mark">BF</div>
      <div><div class="sb-name">BlockForgeMD</div></div>
    </div>
    <div class="sb-tag">API Reference</div>
    <div class="sb-search"><input id="q" type="text" placeholder="Filter endpoints…" autocomplete="off" spellcheck="false"></div>
  </div>
  <div class="cat-list" id="cats"></div>
  <div class="sb-ft" id="total"></div>
</div>

<div id="main">
  <div class="top-bar">
    <span class="base-lbl">Base&nbsp;URL</span>
    <input class="base-in" id="base" type="text" value="{{.}}" spellcheck="false">
    <span class="base-lbl" style="margin-left:16px;flex-shrink:0">API Key</span>
    <input class="base-in" id="apikey" type="text" placeholder="sk_live_…  (injected into all /api/* examples)" spellcheck="false" style="flex:2;min-width:200px;font-family:var(--mono);font-size:11px;letter-spacing:.02em">
  </div>
  <div id="content"></div>
</div>

<script>
var CATS=[
  {id:'files',label:'Files',items:[
    {method:'GET',path:'/api/files',sum:'List all files',
     desc:'Returns every file in the database ordered by position, including title, type, and path.',
     params:[{name:'workspace',req:false,type:'string',desc:'Filter to a specific workspace, e.g. Default'}],
     curl:function(b){return b+'/api/files?workspace=Default'},
     resp:'{\n  "files": [\n    {\n      "path": "Default/Documents/Notes.md",\n      "title": "Notes",\n      "type": "document"\n    }\n  ]\n}'},
    {method:'GET',path:'/api/file',sum:'Get file content',
     desc:'Returns the raw Markdown content, front-matter, and metadata for a single file.',
     params:[{name:'path',req:true,type:'string',desc:'Workspace-relative file path, e.g. Default/Documents/Notes.md'}],
     curl:function(b){return b+'/api/file?path=Default%2FDocuments%2FNotes.md'}},
    {method:'POST',path:'/api/file',sum:'Save file content',
     desc:'Creates or overwrites a file with the provided Markdown content.',
     body:'{"path":"Default/Documents/Notes.md","content":"# Hello\\n\\nWorld"}',
     curl:function(b){return b+'/api/file'}},
    {method:'DELETE',path:'/api/file',sum:'Delete a file (moves to trash)',
     params:[{name:'path',req:true,type:'string',desc:'Path of the file to delete'}],
     curl:function(b){return b+'/api/file?path=Default%2FDocuments%2FOld.md'}},
    {method:'DELETE',path:'/api/folder',sum:'Delete a folder',
     params:[{name:'path',req:true,type:'string',desc:'Workspace-relative folder path'}],
     curl:function(b){return b+'/api/folder?path=Default%2FDocuments%2FOldFolder'}},
    {method:'PATCH',path:'/api/file/front-matter',sum:'Update front-matter fields',
     desc:'Atomically updates specific YAML front-matter keys without touching the document body. Used by Kanban drag-and-drop to change status, due date, etc.',
     body:'{"path":"Default/Boards/board/Card.md","updates":{"status":"Done","dueDate":"2026-08-01"}}',
     curl:function(b){return b+'/api/file/front-matter'}},
    {method:'PATCH',path:'/api/file/task',sum:'Toggle checkbox task completion',
     desc:'Marks an inline checkbox task as completed or not. Use lineNumber (1-indexed) from the file to identify the task.',
     body:'{"path":"Default/Documents/Notes.md","lineNumber":5,"completed":true}',
     curl:function(b){return b+'/api/file/task'}},
    {method:'POST',path:'/api/file/move',sum:'Move or rename a file',
     body:'{"from":"Default/Documents/OldName.md","to":"Default/Documents/NewName.md"}',
     curl:function(b){return b+'/api/file/move'}}
  ]},
  {id:'cards',label:'Boards & Cards',items:[
    {method:'GET',path:'/api/cards',sum:'Query Kanban cards with filters',
     desc:'Returns card files (Markdown files under a board\'s directory) with optional filtering. All card metadata — status, due date, assignee, priority — lives in each card\'s YAML front-matter and is exposed in the fields object.',
     params:[
       {name:'board',req:false,type:'string',desc:'Board file path, e.g. Default/Boards/board.board.md — card directory is derived automatically'},
       {name:'prefix',req:false,type:'string',desc:'Raw path prefix, e.g. Default/Boards/board/ (alternative to board)'},
       {name:'overdue',req:false,type:'boolean',desc:'"true" returns only cards where dueDate is strictly before today'},
       {name:'due_before',req:false,type:'string',desc:'ISO date YYYY-MM-DD — cards with dueDate before this value'},
       {name:'status',req:false,type:'string',desc:'Exact match on status field, e.g. "In Progress"'},
       {name:'assignee',req:false,type:'string',desc:'Exact match on assignee field'}
     ],
     curl:function(b){return b+'/api/cards?board=Default%2FBoards%2Fboard.board.md&overdue=true'},
     resp:'{\n  "count": 1,\n  "cards": [\n    {\n      "path": "Default/Boards/board/Task.md",\n      "title": "Task",\n      "updatedAt": "2026-06-20T09:00:00Z",\n      "fields": {\n        "dueDate": "2026-06-15",\n        "status": "In Progress",\n        "assignee": "Alice"\n      }\n    }\n  ]\n}'}
  ]},
  {id:'search',label:'Search & Graph',items:[
    {method:'GET',path:'/api/search',sum:'Full-text search across files',
     params:[
       {name:'q',req:true,type:'string',desc:'Search query'},
       {name:'workspace',req:false,type:'string',desc:'Scope results to a workspace'}
     ],
     curl:function(b){return b+'/api/search?q=meeting+notes&workspace=Default'}},
    {method:'GET',path:'/api/backlinks',sum:'Get backlinks to a file',
     desc:'Returns all files that contain a Markdown link pointing to the given path.',
     params:[{name:'path',req:true,type:'string',desc:'Target file path'}],
     curl:function(b){return b+'/api/backlinks?path=Default%2FDocuments%2FNotes.md'}},
    {method:'GET',path:'/api/graph',sum:'Knowledge graph nodes and edges',
     desc:'Returns the full link graph for a workspace — nodes are files, edges are Markdown links. Used by the graph view.',
     params:[{name:'workspace',req:false,type:'string',desc:'Workspace to graph; omit for all workspaces'}],
     curl:function(b){return b+'/api/graph?workspace=Default'},
     resp:'{\n  "nodes": [{ "id": "Default/Documents/Notes.md", "title": "Notes", "type": "document" }],\n  "edges": [{ "source": "Default/Documents/Notes.md", "target": "Default/Documents/Linked.md" }]\n}'},
    {method:'GET',path:'/api/link-preview',sum:'Fetch external URL metadata',
     desc:'Retrieves Open Graph title, description, and image for an external URL. Used to render link embeds in the editor.',
     params:[{name:'url',req:true,type:'string',desc:'External URL to preview'}],
     curl:function(b){return b+'/api/link-preview?url=https%3A%2F%2Fgithub.com'}}
  ]},
  {id:'history',label:'History',items:[
    {method:'GET',path:'/api/file/history',sum:'List file revisions',
     desc:'Returns saved revisions for a file, each with a content hash and timestamp.',
     params:[{name:'path',req:true,type:'string',desc:'File path'}],
     curl:function(b){return b+'/api/file/history?path=Default%2FDocuments%2FNotes.md'}},
    {method:'GET',path:'/api/file/history/content',sum:'Get a specific revision',
     params:[
       {name:'path',req:true,type:'string',desc:'File path'},
       {name:'timestamp',req:true,type:'integer',desc:'Unix timestamp from the history list'}
     ],
     curl:function(b){return b+'/api/file/history/content?path=Default%2FDocuments%2FNotes.md&timestamp=1783179803'}},
    {method:'POST',path:'/api/file/rollback',sum:'Roll back to a revision',
     desc:'Overwrites the current file with content from a specific revision. Use the timestamp from the history list.',
     body:'{"path":"Default/Documents/Notes.md","timestamp":1783179803}',
     curl:function(b){return b+'/api/file/rollback'}}
  ]},
  {id:'upload',label:'Assets',items:[
    {method:'POST',path:'/api/upload',sum:'Upload an asset file',
     desc:'Uploads an image or other asset into the workspace assets directory. Returns the asset URL for use in Markdown.',
     params:[{name:'workspace',req:true,type:'string',desc:'Workspace to store the asset in'}],
     formData:'-F "file=@/path/to/image.png"',
     curl:function(b){return b+'/api/upload?workspace=Default'}}
  ]},
  {id:'workspaces',label:'Workspaces',items:[
    {method:'GET',path:'/api/workspaces',sum:'List all workspaces',
     curl:function(b){return b+'/api/workspaces'},
     resp:'{ "workspaces": ["Default", "Work", "Personal"] }'},
    {method:'POST',path:'/api/workspaces',sum:'Create a workspace',
     body:'{"name":"My Workspace"}',
     curl:function(b){return b+'/api/workspaces'}},
    {method:'POST',path:'/api/workspaces/rename',sum:'Rename a workspace',
     desc:'Renames a workspace directory and updates all internal path references. Old and new names must differ.',
     body:'{"oldName":"My Workspace","newName":"Main Workspace"}',
     curl:function(b){return b+'/api/workspaces/rename'}}
  ]},
  {id:'settings',label:'Settings',items:[
    {method:'GET',path:'/api/settings',sum:'Get all app settings',
     curl:function(b){return b+'/api/settings'},
     resp:'{\n  "theme": "dark",\n  "history_limit": 50,\n  "trash_retention_days": 30,\n  "default_page": "Default/Documents/Home.md",\n  "sidebar_collapsed": false\n}'},
    {method:'POST',path:'/api/settings',sum:'Save settings',
     desc:'Updates one or more settings. All fields are optional — only provided fields are changed.',
     body:'{"theme":"dark","history_limit":100,"sidebar_collapsed":true,"default_page":"Default/Documents/Home.md"}',
     curl:function(b){return b+'/api/settings'}},
    {method:'GET',path:'/api/favorites',sum:'Get favorites list',
     params:[{name:'workspace',req:true,type:'string',desc:'Workspace name'}],
     curl:function(b){return b+'/api/favorites?workspace=Default'},
     resp:'{ "favorites": ["Default/Documents/Notes.md","Default/Documents/Ideas.md"] }'},
    {method:'POST',path:'/api/favorites',sum:'Set favorites list',
     desc:'Replaces the entire favorites list for the given workspace.',
     body:'{"workspace":"Default","favorites":["Default/Documents/Notes.md"]}',
     curl:function(b){return b+'/api/favorites'}}
  ]},
  {id:'trash',label:'Trash',items:[
    {method:'GET',path:'/api/trash',sum:'List deleted files',
     params:[{name:'workspace',req:false,type:'string',desc:'Workspace to scope results'}],
     curl:function(b){return b+'/api/trash?workspace=Default'}},
    {method:'GET',path:'/api/trash/search',sum:'Search deleted files',
     params:[
       {name:'q',req:true,type:'string',desc:'Search query'},
       {name:'workspace',req:false,type:'string',desc:'Workspace scope'}
     ],
     curl:function(b){return b+'/api/trash/search?q=old+notes&workspace=Default'}},
    {method:'GET',path:'/api/trash/content',sum:'Get deleted file content',
     desc:'Returns the content of a specific file inside a trash item. Requires both the trash item id and the original file path, both obtained from the trash list.',
     params:[
       {name:'id',req:true,type:'string',desc:'Trash item ID (from trash list), e.g. 1783190079627154581'},
       {name:'path',req:true,type:'string',desc:'Original file path (from trash list files array)'},
       {name:'workspace',req:false,type:'string',desc:'Workspace name'}
     ],
     curl:function(b){return b+'/api/trash/content?workspace=Default&id=1783190079627154581&path=Default%2FBoards%2Fboard%2Fdafda.md'}},
    {method:'POST',path:'/api/trash/restore',sum:'Restore a deleted file',
     body:'{"id":"1783190079627154581","workspace":"Default"}',
     curl:function(b){return b+'/api/trash/restore'}},
    {method:'DELETE',path:'/api/trash',sum:'Permanently delete one item',
     params:[
       {name:'id',req:true,type:'string',desc:'Trash item ID'},
       {name:'workspace',req:false,type:'string',desc:'Workspace name'}
     ],
     curl:function(b){return b+'/api/trash?id=1783190079627154581&workspace=Default'}},
    {method:'DELETE',path:'/api/trash/all',sum:'Empty trash (permanent)',
     desc:'Permanently deletes every item in trash. Cannot be undone.',
     params:[{name:'workspace',req:false,type:'string',desc:'Workspace to empty'}],
     curl:function(b){return b+'/api/trash/all?workspace=Default'}}
  ]},
  {id:'sync',label:'Sync',items:[
    {method:'GET',path:'/api/sync/events',sum:'Server-Sent Events stream',
     desc:'SSE endpoint that pushes real-time filesystem change events (create, update, delete, rename). The app uses this to keep the editor and file tree in sync across tabs. Connect with EventSource.',
     curl:function(b){return b+'/api/sync/events'}}
  ]},
  {id:'auth',label:'Authentication',items:[
    {method:'GET',path:'/auth/status',sum:'Check auth state (public)',
     desc:'Returns whether a first-time admin account needs to be created (bootstrapRequired) and, if a valid session cookie is present, the currently logged-in user. This endpoint is always public — no credentials required.',
     curl:function(b){return b+'/auth/status'},
     resp:'{"bootstrapRequired":false,"user":{"id":"a1b2c3","username":"admin"}}'},
    {method:'POST',path:'/auth/bootstrap',sum:'Create first admin (public)',
     desc:'Creates the initial admin user. Returns 403 Forbidden if any user already exists. This endpoint is public and only works once.',
     body:'{"username":"admin","password":"mysecretpassword"}',
     curl:function(b){return b+'/auth/bootstrap'},
     resp:'{"status":"ok","user":{"id":"a1b2c3","username":"admin"}}'},
    {method:'POST',path:'/auth/login',sum:'Log in (receive session cookie)',
     desc:'Validates credentials and sets an HTTP-only session cookie (bf_session, 7-day expiry, SameSite=Lax). Use -c to save the cookie to a file, then pass it with -b on subsequent requests.',
     body:'{"username":"admin","password":"mysecretpassword"}',
     raw:'curl -X POST -H "Content-Type: application/json" \\\n  -c cookies.txt \\\n  -d \'{"username":"admin","password":"mysecretpassword"}\' \\\n  "__BASE__/auth/login"',
     resp:'{"status":"ok","user":{"id":"a1b2c3","username":"admin"}}'},
    {method:'POST',path:'/auth/logout',sum:'Log out (clear session)',
     desc:'Deletes the server-side session and clears the bf_session cookie.',
     raw:'curl -X POST -b cookies.txt "__BASE__/auth/logout"',
     resp:'{"status":"ok"}'},
    {method:'GET',path:'/auth/me',sum:'Get current user',
     desc:'Returns the currently authenticated user. Returns 401 if not logged in.',
     raw:'curl -b cookies.txt "__BASE__/auth/me"',
     resp:'{"id":"a1b2c3","username":"admin"}'}
  ]},
  {id:'users',label:'Users & API Keys',items:[
    {method:'GET',path:'/api/users',sum:'List all users',
     desc:'Returns all user accounts. Password hashes are never included. Requires authentication.',
     curl:function(b){return b+'/api/users'},
     resp:'{"users":[{"id":"a1b2","username":"admin","createdAt":"2026-07-04T10:00:00Z"}]}'},
    {method:'POST',path:'/api/users',sum:'Create a user',
     desc:'Creates a new user account. Requires authentication. Returns 409 if username already exists.',
     body:'{"username":"alice","password":"securepassword"}',
     curl:function(b){return b+'/api/users'}},
    {method:'GET',path:'/api/keys',sum:'List API keys for current user',
     desc:'Returns all API keys belonging to the authenticated user. The secret key value is never returned — only ID, label, and timestamps.',
     curl:function(b){return b+'/api/keys'},
     resp:'{"keys":[{"id":"k1","label":"CI Bot","createdAt":"2026-07-04T10:00:00Z","lastUsedAt":"2026-07-04T11:00:00Z"}]}'},
    {method:'POST',path:'/api/keys',sum:'Generate API key',
     desc:'Generates a new sk_live_… key. The plaintext is returned once only — copy it immediately. Use it as a Bearer token: Authorization: Bearer sk_live_…',
     body:'{"label":"My automation script"}',
     curl:function(b){return b+'/api/keys'},
     resp:'{"id":"k1","key":"sk_live_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"}'},
    {method:'DELETE',path:'/api/keys/{id}',sum:'Revoke an API key',
     desc:'Permanently deletes an API key. Scoped to the current user — you can only revoke your own keys.',
     curl:function(b){return b+'/api/keys/KEY_ID_HERE'},
     resp:'{"status":"ok"}'}
  ]},
  {id:'plugins',label:'Plugins',items:[
    {method:'GET',path:'/api/plugins',sum:'List available plugins',
     desc:'Returns the Plugin Store grid: real, usable plugins alongside coming-soon placeholders.',
     curl:function(b){return b+'/api/plugins'},
     resp:'{"plugins":[{"id":"google-calendar","name":"Google Calendar","category":"calendar","status":"available"},{"id":"mcp-servers","name":"MCP Servers","category":"mcp","status":"coming_soon"}]}'},
    {method:'GET',path:'/api/plugins/google-calendar/config',sum:'Get shared Google OAuth config',
     desc:'Returns the instance-wide Google OAuth Client ID (plain), whether a Client Secret has been saved (the secret itself is never returned), the background sync interval, plus the exact redirectUri to register in Google Cloud Console.',
     curl:function(b){return b+'/api/plugins/google-calendar/config'},
     resp:'{"clientId":"123-abc.apps.googleusercontent.com","hasClientSecret":true,"pollIntervalSeconds":120,"redirectUri":"https://notes.example.com/api/plugins/google-calendar/oauth/callback"}'},
    {method:'POST',path:'/api/plugins/google-calendar/config',sum:'Set shared Google OAuth config',
     desc:'Saves the instance-wide Client ID/Secret (from a Google Cloud Console OAuth Client you create yourself) and/or the background sync interval. Omit clientSecret to update just the Client ID and leave the previously saved secret untouched. Omit pollIntervalSeconds to leave the interval unchanged; minimum is 30 seconds.',
     body:'{"clientId":"123-abc.apps.googleusercontent.com","clientSecret":"GOCSPX-...","pollIntervalSeconds":120}',
     curl:function(b){return b+'/api/plugins/google-calendar/config'}},
    {method:'GET',path:'/api/plugins/google-calendar/oauth/start',sum:'Begin per-user Google connect flow',
     desc:'Returns a Google consent-screen URL for the current user. The frontend does a full-page redirect to it (not a popup). Requires the shared Client ID/Secret to already be configured.',
     curl:function(b){return b+'/api/plugins/google-calendar/oauth/start'},
     resp:'{"authorizeUrl":"https://accounts.google.com/o/oauth2/v2/auth?..."}'},
    {method:'GET',path:'/api/plugins/google-calendar/oauth/callback',sum:'OAuth redirect target (public)',
     desc:'Google redirects the user\'s browser here after consent — not meant to be called directly. Not session-authenticated — a signed "state" param (bound to the user who started the flow) is verified instead. Redirects back to / on success.',
     curl:function(b){return b+'/api/plugins/google-calendar/oauth/callback?state=...&code=...'}},
    {method:'GET',path:'/api/plugins/google-calendar/status',sum:'Get current user\'s connection status',
     curl:function(b){return b+'/api/plugins/google-calendar/status'},
     resp:'{"connected":true,"googleEmail":"alice@gmail.com","lastSyncAt":"2026-07-27T10:00:00Z","lastSyncError":"","syncedPageCount":5}'},
    {method:'POST',path:'/api/plugins/google-calendar/disconnect',sum:'Disconnect current user\'s Google account',
     desc:'Best-effort revokes the token with Google, then deletes the stored account and all of its file↔event sync mappings.',
     curl:function(b){return b+'/api/plugins/google-calendar/disconnect'},
     resp:'{"status":"ok"}'},
    {method:'POST',path:'/api/plugins/google-calendar/sync-now',sum:'Trigger an immediate sync pass',
     desc:'Kicks off one sync pass for the current user in the background (202 Accepted). Poll status afterward to see the result.',
     curl:function(b){return b+'/api/plugins/google-calendar/sync-now'},
     resp:'{"status":"syncing"}'},
    {method:'GET',path:'/api/plugins/google-calendar/calendars',sum:'List calendars available to sync to',
     desc:'Returns every calendar the connected Google account can write events to (minAccessRole=writer), for the calendar picker.',
     curl:function(b){return b+'/api/plugins/google-calendar/calendars'},
     resp:'{"calendars":[{"id":"primary","summary":"alice@gmail.com","primary":true},{"id":"abc123@group.calendar.google.com","summary":"Work","primary":false}]}'},
    {method:'POST',path:'/api/plugins/google-calendar/calendar',sum:'Choose which calendar to sync to',
     desc:'Switches which calendar the current user\'s pages sync to. Best-effort deletes any events already synced to the previous calendar and clears sync-state mappings so the next sync recreates fresh events on the newly selected calendar.',
     body:'{"calendarId":"abc123@group.calendar.google.com"}',
     curl:function(b){return b+'/api/plugins/google-calendar/calendar'},
     resp:'{"status":"ok"}'}
  ]}
];

function h(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function base(){return document.getElementById('base').value.replace(/\/$/,'')}
function key(){return document.getElementById('apikey').value.trim()}

// Builds a properly-formatted curl command from parts.
// url   – the full URL string
// method – GET / POST / PATCH / DELETE
// body   – JSON body string (for -d flag), or null
// fd     – form-data flag string (for -F flag), or null
// k      – API key (Bearer token), or empty string
// isApi  – true for /api/* endpoints (where Bearer auth applies)
function makeCurl(url, method, body, fd, k, isApi){
  var args=[];
  if(k&&isApi) args.push('-H "Authorization: Bearer '+k+'"');
  if(method!=='GET') args.push('-X '+method);
  if(fd){
    args.push(fd);
  } else if(body){
    args.push('-H "Content-Type: application/json"');
    args.push("-d '"+body+"'");
  }
  args.push('"'+url+'"');
  if(args.length===1) return 'curl '+args[0];
  return 'curl \\\n  '+args.join(' \\\n  ');
}

function buildSidebar(f){
  var html='',tot=0;
  CATS.forEach(function(cat){
    var vis=f?cat.items.filter(function(ep){
      var fq=f.toLowerCase();
      return ep.path.toLowerCase().indexOf(fq)!==-1||ep.sum.toLowerCase().indexOf(fq)!==-1||(ep.desc&&ep.desc.toLowerCase().indexOf(fq)!==-1);
    }):cat.items;
    tot+=cat.items.length;
    if(vis.length===0&&f)return;
    html+='<a class="cat-item" href="#s-'+cat.id+'" data-id="'+cat.id+'">'+h(cat.label)+'<span class="cat-badge">'+(f?vis.length:cat.items.length)+'</span></a>';
  });
  document.getElementById('cats').innerHTML=html;
  document.getElementById('total').textContent=tot+' endpoints';
  document.querySelectorAll('.cat-item').forEach(function(el){
    el.addEventListener('click',function(e){
      e.preventDefault();
      var t=document.getElementById('s-'+el.dataset.id);
      if(t)t.scrollIntoView({behavior:'smooth',block:'start'});
      document.querySelectorAll('.cat-item').forEach(function(x){x.classList.remove('active')});
      el.classList.add('active');
    });
  });
}

function buildContent(f){
  var b=base();
  var k=key();
  var html='';
  CATS.forEach(function(cat){
    var vis=f?cat.items.filter(function(ep){
      var fq=f.toLowerCase();
      return ep.path.toLowerCase().indexOf(fq)!==-1||ep.sum.toLowerCase().indexOf(fq)!==-1||(ep.desc&&ep.desc.toLowerCase().indexOf(fq)!==-1);
    }):cat.items;
    if(vis.length===0&&f)return;
    html+='<div class="cat-sec" id="s-'+cat.id+'"><div class="cat-hd">'+h(cat.label)+'</div>';
    vis.forEach(function(ep,i){
      var uid=cat.id+'-'+i;
      var cc;
      if(ep.raw){
        // Auth endpoints with session-cookie flags: substitute __BASE__ placeholder
        cc=ep.raw.replace(/__BASE__/g,b);
      } else {
        cc=makeCurl(ep.curl(b), ep.method, ep.body||null, ep.formData||null, k, ep.path.startsWith('/api/'));
      }
      html+='<div class="ep" id="e-'+uid+'">';
      html+='<div class="ep-hd" onclick="tog(\''+uid+'\')"><span class="badge '+ep.method+'">'+ep.method+'</span><span class="ep-path">'+h(ep.path)+'</span><span class="ep-sum">'+h(ep.sum)+'</span><svg class="chev" width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></div>';
      html+='<div class="ep-body">';
      if(ep.desc)html+='<p class="ep-desc">'+h(ep.desc)+'</p>';
      if(ep.params&&ep.params.length){
        html+='<div class="tbl-lbl">Parameters</div><div style="overflow-x:auto"><table class="ptbl"><thead><tr><th>Name</th><th>Type</th><th></th><th>Description</th></tr></thead><tbody>';
        ep.params.forEach(function(p){
          html+='<tr><td><span class="pname">'+h(p.name)+'</span></td><td><span class="ptype">'+h(p.type)+'</span></td><td>'+(p.req?'<span class="preq">required</span>':'<span class="popt">optional</span>')+'</td><td class="pdesc">'+h(p.desc)+'</td></tr>';
        });
        html+='</tbody></table></div>';
      }
      if(ep.body){
        html+='<div class="code-lbl">Request Body</div><div class="cblock"><pre>'+h(ep.body)+'</pre></div>';
      }
      html+='<div class="code-lbl">cURL Example</div><div class="cblock"><pre><span class="prompt">$ </span><span class="cc" id="cc-'+uid+'">'+h(cc)+'</span></pre><button class="copy-btn" id="cp-'+uid+'" onclick="cp(\''+uid+'\')">Copy</button></div>';
      if(ep.resp)html+='<div class="code-lbl">Example Response</div><pre class="resp-block">'+h(ep.resp)+'</pre>';
      html+='</div></div>';
    });
    html+='</div>';
  });
  document.getElementById('content').innerHTML=html;
}

function tog(uid){var c=document.getElementById('e-'+uid);if(c)c.classList.toggle('open')}

function cp(uid){
  var el=document.getElementById('cc-'+uid);
  if(!el)return;
  navigator.clipboard.writeText(el.textContent).then(function(){
    var btn=document.getElementById('cp-'+uid);
    if(!btn)return;
    btn.textContent='Copied!';btn.classList.add('ok');
    setTimeout(function(){btn.textContent='Copy';btn.classList.remove('ok')},1800);
  });
}

var ft;
document.getElementById('q').addEventListener('input',function(e){
  clearTimeout(ft);ft=setTimeout(function(){var f=e.target.value.trim();buildSidebar(f);buildContent(f);},120);
});
document.getElementById('base').addEventListener('change',function(){
  buildContent(document.getElementById('q').value.trim());
});
document.getElementById('apikey').addEventListener('input',function(){
  buildContent(document.getElementById('q').value.trim());
});

buildSidebar('');buildContent('');
var fc=document.querySelector('.cat-item');if(fc)fc.classList.add('active');

var obs=new IntersectionObserver(function(entries){
  entries.forEach(function(entry){
    if(entry.isIntersecting){
      var id=entry.target.id.replace('s-','');
      document.querySelectorAll('.cat-item').forEach(function(el){el.classList.toggle('active',el.dataset.id===id)});
    }
  });
},{root:document.getElementById('main'),threshold:0.15,rootMargin:'-60px 0px 0px 0px'});
document.querySelectorAll('.cat-sec').forEach(function(el){obs.observe(el)});
</script>
</body>
</html>`
