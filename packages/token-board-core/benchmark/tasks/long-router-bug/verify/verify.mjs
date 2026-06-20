import { matchRoute } from "../src/routes.mjs";

const cases = [
  // 基础路由
  ["/users",                     "getUserList"          ],
  ["/users/new",                  "createUser"           ],
  ["/users/42",                   "getUserById"          ],
  ["/users/42/edit",              "updateUser"           ],
  ["/posts/99/publish",           "publishPost"          ],
  ["/comments/7/remove",          "deleteComment"        ],
  ["/tags/3/edit",                "updateTag"            ],
  ["/categories/5/remove",        "deleteCategory"       ],
  ["/media/upload",               "uploadMedia"          ],
  ["/permissions/1/edit",         "updatePermission"     ],
  // 关键断言：roles 的 edit 路由必须返回 updateRole，而非 deleteRole
  ["/roles/10/edit",              "updateRole"           ],
  // roles 的 remove 路由必须仍然返回 deleteRole
  ["/roles/10/remove",            "deleteRole"           ],
  // 其他 roles 路由
  ["/roles",                      "getRoleList"          ],
  ["/roles/new",                  "createRole"           ],
  ["/roles/55",                   "getRoleById"          ],
  // 通知与搜索
  ["/notifications/3/read",       "markNotificationRead" ],
  ["/search/posts",               "searchPosts"          ],
  // 不存在的路由
  ["/nonexistent",                null                   ],
];

let failed = false;
for (const [path, expected] of cases) {
  const got = matchRoute(path);
  if (got !== expected) {
    console.error(`FAIL matchRoute("${path}") => ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log("OK long-router-bug");
process.exit(0);
