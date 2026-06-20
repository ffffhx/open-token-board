/**
 * 路由表 — 将 URL 路径映射到处理函数名称。
 *
 * matchRoute(path) 接收一个以 "/" 开头的路径字符串，
 * 返回该路径对应的处理函数名称字符串；
 * 若路径不存在则返回 null。
 *
 * 命名约定（以资源 resource 为例）：
 *   /resource              => getResourceList
 *   /resource/:id          => getResourceById
 *   /resource/new          => createResource
 *   /resource/:id/edit     => updateResource
 *   /resource/:id/remove   => deleteResource
 *
 * 匹配优先级：静态段优先于动态段（含 ":" 的段）。
 */

const ROUTES = [
  // ── 用户 (users) ─────────────────────────────────────────────
  { path: "/users",                       handler: "getUserList"            },
  { path: "/users/new",                   handler: "createUser"             },
  { path: "/users/:id",                   handler: "getUserById"            },
  { path: "/users/:id/edit",              handler: "updateUser"             },
  { path: "/users/:id/remove",            handler: "deleteUser"             },
  { path: "/users/:id/profile",           handler: "getUserProfile"         },
  { path: "/users/:id/avatar",            handler: "getUserAvatar"          },

  // ── 文章 (posts) ─────────────────────────────────────────────
  { path: "/posts",                       handler: "getPostList"            },
  { path: "/posts/new",                   handler: "createPost"             },
  { path: "/posts/:id",                   handler: "getPostById"            },
  { path: "/posts/:id/edit",              handler: "updatePost"             },
  { path: "/posts/:id/remove",            handler: "deletePost"             },
  { path: "/posts/:id/publish",           handler: "publishPost"            },
  { path: "/posts/:id/unpublish",         handler: "unpublishPost"          },

  // ── 评论 (comments) ──────────────────────────────────────────
  { path: "/comments",                    handler: "getCommentList"         },
  { path: "/comments/new",               handler: "createComment"           },
  { path: "/comments/:id",               handler: "getCommentById"          },
  { path: "/comments/:id/edit",           handler: "updateComment"          },
  { path: "/comments/:id/remove",         handler: "deleteComment"          },

  // ── 标签 (tags) ──────────────────────────────────────────────
  { path: "/tags",                        handler: "getTagList"             },
  { path: "/tags/new",                    handler: "createTag"              },
  { path: "/tags/:id",                    handler: "getTagById"             },
  { path: "/tags/:id/edit",               handler: "updateTag"              },
  { path: "/tags/:id/remove",             handler: "deleteTag"              },

  // ── 分类 (categories) ────────────────────────────────────────
  { path: "/categories",                  handler: "getCategoryList"        },
  { path: "/categories/new",              handler: "createCategory"         },
  { path: "/categories/:id",              handler: "getCategoryById"        },
  { path: "/categories/:id/edit",         handler: "updateCategory"         },
  { path: "/categories/:id/remove",       handler: "deleteCategory"         },

  // ── 媒体 (media) ─────────────────────────────────────────────
  { path: "/media",                       handler: "getMediaList"           },
  { path: "/media/upload",                handler: "uploadMedia"            },
  { path: "/media/:id",                   handler: "getMediaById"           },
  { path: "/media/:id/remove",            handler: "deleteMedia"            },

  // ── 权限 (permissions) ───────────────────────────────────────
  { path: "/permissions",                 handler: "getPermissionList"      },
  { path: "/permissions/new",             handler: "createPermission"       },
  { path: "/permissions/:id",             handler: "getPermissionById"      },
  { path: "/permissions/:id/edit",        handler: "updatePermission"       },
  { path: "/permissions/:id/remove",      handler: "deletePermission"       },

  // ── 角色 (roles) ─────────────────────────────────────────────
  { path: "/roles",                       handler: "getRoleList"            },
  { path: "/roles/new",                   handler: "createRole"             },
  { path: "/roles/:id",                   handler: "getRoleById"            },
  // BUG: 应为 "updateRole"，错写成了 "deleteRole"
  { path: "/roles/:id/edit",              handler: "deleteRole"             },
  { path: "/roles/:id/remove",            handler: "deleteRole"             },

  // ── 通知 (notifications) ─────────────────────────────────────
  { path: "/notifications",               handler: "getNotificationList"    },
  { path: "/notifications/:id",           handler: "getNotificationById"    },
  { path: "/notifications/:id/read",      handler: "markNotificationRead"   },
  { path: "/notifications/:id/remove",    handler: "deleteNotification"     },

  // ── 搜索 (search) ────────────────────────────────────────────
  { path: "/search",                      handler: "searchAll"              },
  { path: "/search/users",                handler: "searchUsers"            },
  { path: "/search/posts",                handler: "searchPosts"            },
];

/**
 * 匹配路由，返回对应的处理函数名称；不存在则返回 null。
 * 路径参数（以 ":" 开头的段）可匹配任意非空字符串段。
 * 静态段优先于动态段匹配。
 */
export function matchRoute(path) {
  const segments = path.split("/").filter(Boolean);

  // 先尝试完全静态匹配（无参数段）
  for (const route of ROUTES) {
    const routeSegs = route.path.split("/").filter(Boolean);
    if (routeSegs.length !== segments.length) continue;
    if (routeSegs.some((s) => s.startsWith(":"))) continue;
    if (routeSegs.every((s, i) => s === segments[i])) return route.handler;
  }

  // 再尝试含参数段的匹配
  for (const route of ROUTES) {
    const routeSegs = route.path.split("/").filter(Boolean);
    if (routeSegs.length !== segments.length) continue;
    if (!routeSegs.some((s) => s.startsWith(":"))) continue;
    let match = true;
    for (let i = 0; i < routeSegs.length; i++) {
      if (routeSegs[i].startsWith(":")) continue;
      if (routeSegs[i] !== segments[i]) { match = false; break; }
    }
    if (match) return route.handler;
  }

  return null;
}
