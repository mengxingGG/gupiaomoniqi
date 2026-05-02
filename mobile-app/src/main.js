"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var vue_1 = require("vue");
var pinia_1 = require("pinia");
var App_vue_1 = require("./App.vue");
var router_1 = require("./router");
// Vant 样式
require("vant/lib/index.css");
// 初始化用户状态
var user_1 = require("./stores/user");
var app = (0, vue_1.createApp)(App_vue_1.default);
var pinia = (0, pinia_1.createPinia)();
app.use(pinia);
app.use(router_1.default);
// 初始化用户登录状态
var userStore = (0, user_1.useUserStore)();
userStore.init();
app.mount('#app');
