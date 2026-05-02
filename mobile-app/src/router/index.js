"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var vue_router_1 = require("vue-router");
var router = (0, vue_router_1.createRouter)({
    history: (0, vue_router_1.createWebHistory)(),
    routes: [
        {
            path: '/login',
            name: 'Login',
            component: function () { return Promise.resolve().then(function () { return require('../views/Login.vue'); }); },
            meta: { requiresAuth: false },
        },
        {
            path: '/register',
            name: 'Register',
            component: function () { return Promise.resolve().then(function () { return require('../views/Register.vue'); }); },
            meta: { requiresAuth: false },
        },
        {
            path: '/',
            name: 'Home',
            component: function () { return Promise.resolve().then(function () { return require('../views/Home.vue'); }); },
            meta: { requiresAuth: true },
        },
        {
            path: '/stock/:code',
            name: 'StockDetail',
            component: function () { return Promise.resolve().then(function () { return require('../views/StockDetail.vue'); }); },
            meta: { requiresAuth: true },
        },
        {
            path: '/portfolio',
            name: 'Portfolio',
            component: function () { return Promise.resolve().then(function () { return require('../views/Portfolio.vue'); }); },
            meta: { requiresAuth: true },
        },
        {
            path: '/profile',
            name: 'Profile',
            component: function () { return Promise.resolve().then(function () { return require('../views/Profile.vue'); }); },
            meta: { requiresAuth: true },
        },
    ],
});
// 路由守卫
router.beforeEach(function (to, _from, next) {
    var token = localStorage.getItem('token');
    if (to.meta.requiresAuth && !token) {
        next('/login');
    }
    else if (!to.meta.requiresAuth && token && (to.path === '/login' || to.path === '/register')) {
        next('/');
    }
    else {
        next();
    }
});
exports.default = router;
