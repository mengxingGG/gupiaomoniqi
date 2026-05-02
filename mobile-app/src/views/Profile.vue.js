"use strict";
/// <reference types="../../../../../../../www/server/nodejs/cache/_npx/2db181330ea4b15b/node_modules/@vue/language-core/types/template-helpers.d.ts" />
/// <reference types="../../../../../../../www/server/nodejs/cache/_npx/2db181330ea4b15b/node_modules/@vue/language-core/types/props-fallback.d.ts" />
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var _a, _b, _c, _d, _e, _f;
Object.defineProperty(exports, "__esModule", { value: true });
var vue_1 = require("vue");
var vue_router_1 = require("vue-router");
var vant_1 = require("vant");
var user_1 = require("../stores/user");
var router = (0, vue_router_1.useRouter)();
var userStore = (0, user_1.useUserStore)();
var activeTab = (0, vue_1.ref)(2);
var avatarUrl = (0, vue_1.computed)(function () {
    var _a;
    var name = ((_a = userStore.user) === null || _a === void 0 ? void 0 : _a.displayName) || 'User';
    return "https://api.dicebear.com/7.x/initials/svg?seed=".concat(name);
});
function formatMoney(value) {
    return '¥' + value.toLocaleString('zh-CN', { minimumFractionDigits: 2 });
}
function handleLogout() {
    (0, vant_1.showDialog)({
        title: '提示',
        message: '确定要退出登录吗？',
    }).then(function () {
        userStore.logout();
        router.replace('/login');
    }).catch(function () {
        // 取消
    });
}
var __VLS_ctx = __assign(__assign({}, {}), {});
var __VLS_components;
var __VLS_intrinsics;
var __VLS_directives;
/** @type {__VLS_StyleScopedClasses['user-info']} */ ;
/** @type {__VLS_StyleScopedClasses['user-info']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "profile-page" }));
/** @type {__VLS_StyleScopedClasses['profile-page']} */ ;
var __VLS_0;
/** @ts-ignore @type {typeof __VLS_components.vanNavBar | typeof __VLS_components.VanNavBar} */
vanNavBar;
// @ts-ignore
var __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0({
    title: "我的",
    fixed: true,
    placeholder: true,
}));
var __VLS_2 = __VLS_1.apply(void 0, __spreadArray([{
        title: "我的",
        fixed: true,
        placeholder: true,
    }], __VLS_functionalComponentArgsRest(__VLS_1), false));
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "user-card" }));
/** @type {__VLS_StyleScopedClasses['user-card']} */ ;
var __VLS_5;
/** @ts-ignore @type {typeof __VLS_components.vanImage | typeof __VLS_components.VanImage} */
vanImage;
// @ts-ignore
var __VLS_6 = __VLS_asFunctionalComponent1(__VLS_5, new __VLS_5({
    round: true,
    width: "60",
    height: "60",
    src: (__VLS_ctx.avatarUrl),
}));
var __VLS_7 = __VLS_6.apply(void 0, __spreadArray([{
        round: true,
        width: "60",
        height: "60",
        src: (__VLS_ctx.avatarUrl),
    }], __VLS_functionalComponentArgsRest(__VLS_6), false));
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "user-info" }));
/** @type {__VLS_StyleScopedClasses['user-info']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "name" }));
/** @type {__VLS_StyleScopedClasses['name']} */ ;
(((_a = __VLS_ctx.userStore.user) === null || _a === void 0 ? void 0 : _a.displayName) || '未登录');
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "username" }));
/** @type {__VLS_StyleScopedClasses['username']} */ ;
((_b = __VLS_ctx.userStore.user) === null || _b === void 0 ? void 0 : _b.username);
var __VLS_10;
/** @ts-ignore @type {typeof __VLS_components.vanCellGroup | typeof __VLS_components.VanCellGroup | typeof __VLS_components.vanCellGroup | typeof __VLS_components.VanCellGroup} */
vanCellGroup;
// @ts-ignore
var __VLS_11 = __VLS_asFunctionalComponent1(__VLS_10, new __VLS_10(__assign({ inset: true }, { class: "menu-group" })));
var __VLS_12 = __VLS_11.apply(void 0, __spreadArray([__assign({ inset: true }, { class: "menu-group" })], __VLS_functionalComponentArgsRest(__VLS_11), false));
/** @type {__VLS_StyleScopedClasses['menu-group']} */ ;
var __VLS_15 = __VLS_13.slots.default;
var __VLS_16;
/** @ts-ignore @type {typeof __VLS_components.vanCell | typeof __VLS_components.VanCell} */
vanCell;
// @ts-ignore
var __VLS_17 = __VLS_asFunctionalComponent1(__VLS_16, new __VLS_16({
    title: "账户余额",
    value: (__VLS_ctx.formatMoney(((_c = __VLS_ctx.userStore.user) === null || _c === void 0 ? void 0 : _c.balance) || 0)),
}));
var __VLS_18 = __VLS_17.apply(void 0, __spreadArray([{
        title: "账户余额",
        value: (__VLS_ctx.formatMoney(((_d = __VLS_ctx.userStore.user) === null || _d === void 0 ? void 0 : _d.balance) || 0)),
    }], __VLS_functionalComponentArgsRest(__VLS_17), false));
var __VLS_21;
/** @ts-ignore @type {typeof __VLS_components.vanCell | typeof __VLS_components.VanCell} */
vanCell;
// @ts-ignore
var __VLS_22 = __VLS_asFunctionalComponent1(__VLS_21, new __VLS_21({
    title: "总资产",
    value: (__VLS_ctx.formatMoney(((_e = __VLS_ctx.userStore.user) === null || _e === void 0 ? void 0 : _e.totalAssets) || 0)),
}));
var __VLS_23 = __VLS_22.apply(void 0, __spreadArray([{
        title: "总资产",
        value: (__VLS_ctx.formatMoney(((_f = __VLS_ctx.userStore.user) === null || _f === void 0 ? void 0 : _f.totalAssets) || 0)),
    }], __VLS_functionalComponentArgsRest(__VLS_22), false));
// @ts-ignore
[avatarUrl, userStore, userStore, userStore, userStore, formatMoney, formatMoney,];
var __VLS_13;
var __VLS_26;
/** @ts-ignore @type {typeof __VLS_components.vanCellGroup | typeof __VLS_components.VanCellGroup | typeof __VLS_components.vanCellGroup | typeof __VLS_components.VanCellGroup} */
vanCellGroup;
// @ts-ignore
var __VLS_27 = __VLS_asFunctionalComponent1(__VLS_26, new __VLS_26(__assign({ inset: true }, { class: "menu-group" })));
var __VLS_28 = __VLS_27.apply(void 0, __spreadArray([__assign({ inset: true }, { class: "menu-group" })], __VLS_functionalComponentArgsRest(__VLS_27), false));
/** @type {__VLS_StyleScopedClasses['menu-group']} */ ;
var __VLS_31 = __VLS_29.slots.default;
var __VLS_32;
/** @ts-ignore @type {typeof __VLS_components.vanCell | typeof __VLS_components.VanCell} */
vanCell;
// @ts-ignore
var __VLS_33 = __VLS_asFunctionalComponent1(__VLS_32, new __VLS_32({
    title: "设置",
    isLink: true,
    to: "/settings",
}));
var __VLS_34 = __VLS_33.apply(void 0, __spreadArray([{
        title: "设置",
        isLink: true,
        to: "/settings",
    }], __VLS_functionalComponentArgsRest(__VLS_33), false));
var __VLS_37;
/** @ts-ignore @type {typeof __VLS_components.vanCell | typeof __VLS_components.VanCell} */
vanCell;
// @ts-ignore
var __VLS_38 = __VLS_asFunctionalComponent1(__VLS_37, new __VLS_37({
    title: "关于",
    isLink: true,
}));
var __VLS_39 = __VLS_38.apply(void 0, __spreadArray([{
        title: "关于",
        isLink: true,
    }], __VLS_functionalComponentArgsRest(__VLS_38), false));
// @ts-ignore
[];
var __VLS_29;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "logout" }));
/** @type {__VLS_StyleScopedClasses['logout']} */ ;
var __VLS_42;
/** @ts-ignore @type {typeof __VLS_components.vanButton | typeof __VLS_components.VanButton | typeof __VLS_components.vanButton | typeof __VLS_components.VanButton} */
vanButton;
// @ts-ignore
var __VLS_43 = __VLS_asFunctionalComponent1(__VLS_42, new __VLS_42(__assign({ 'onClick': {} }, { block: true, type: "danger", plain: true })));
var __VLS_44 = __VLS_43.apply(void 0, __spreadArray([__assign({ 'onClick': {} }, { block: true, type: "danger", plain: true })], __VLS_functionalComponentArgsRest(__VLS_43), false));
var __VLS_47;
var __VLS_48 = ({ click: {} },
    { onClick: (__VLS_ctx.handleLogout) });
var __VLS_49 = __VLS_45.slots.default;
// @ts-ignore
[handleLogout,];
var __VLS_45;
var __VLS_46;
var __VLS_50;
/** @ts-ignore @type {typeof __VLS_components.vanTabbar | typeof __VLS_components.VanTabbar | typeof __VLS_components.vanTabbar | typeof __VLS_components.VanTabbar} */
vanTabbar;
// @ts-ignore
var __VLS_51 = __VLS_asFunctionalComponent1(__VLS_50, new __VLS_50({
    modelValue: (__VLS_ctx.activeTab),
    fixed: true,
}));
var __VLS_52 = __VLS_51.apply(void 0, __spreadArray([{
        modelValue: (__VLS_ctx.activeTab),
        fixed: true,
    }], __VLS_functionalComponentArgsRest(__VLS_51), false));
var __VLS_55 = __VLS_53.slots.default;
var __VLS_56;
/** @ts-ignore @type {typeof __VLS_components.vanTabbarItem | typeof __VLS_components.VanTabbarItem | typeof __VLS_components.vanTabbarItem | typeof __VLS_components.VanTabbarItem} */
vanTabbarItem;
// @ts-ignore
var __VLS_57 = __VLS_asFunctionalComponent1(__VLS_56, new __VLS_56({
    icon: "chart-trending-o",
    to: "/",
}));
var __VLS_58 = __VLS_57.apply(void 0, __spreadArray([{
        icon: "chart-trending-o",
        to: "/",
    }], __VLS_functionalComponentArgsRest(__VLS_57), false));
var __VLS_61 = __VLS_59.slots.default;
// @ts-ignore
[activeTab,];
var __VLS_59;
var __VLS_62;
/** @ts-ignore @type {typeof __VLS_components.vanTabbarItem | typeof __VLS_components.VanTabbarItem | typeof __VLS_components.vanTabbarItem | typeof __VLS_components.VanTabbarItem} */
vanTabbarItem;
// @ts-ignore
var __VLS_63 = __VLS_asFunctionalComponent1(__VLS_62, new __VLS_62({
    icon: "balance-list-o",
    to: "/portfolio",
}));
var __VLS_64 = __VLS_63.apply(void 0, __spreadArray([{
        icon: "balance-list-o",
        to: "/portfolio",
    }], __VLS_functionalComponentArgsRest(__VLS_63), false));
var __VLS_67 = __VLS_65.slots.default;
// @ts-ignore
[];
var __VLS_65;
var __VLS_68;
/** @ts-ignore @type {typeof __VLS_components.vanTabbarItem | typeof __VLS_components.VanTabbarItem | typeof __VLS_components.vanTabbarItem | typeof __VLS_components.VanTabbarItem} */
vanTabbarItem;
// @ts-ignore
var __VLS_69 = __VLS_asFunctionalComponent1(__VLS_68, new __VLS_68({
    icon: "user-o",
    to: "/profile",
}));
var __VLS_70 = __VLS_69.apply(void 0, __spreadArray([{
        icon: "user-o",
        to: "/profile",
    }], __VLS_functionalComponentArgsRest(__VLS_69), false));
var __VLS_73 = __VLS_71.slots.default;
// @ts-ignore
[];
var __VLS_71;
// @ts-ignore
[];
var __VLS_53;
// @ts-ignore
[];
var __VLS_export = (await Promise.resolve().then(function () { return require('vue'); })).defineComponent({});
exports.default = {};
