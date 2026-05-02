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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
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
Object.defineProperty(exports, "__esModule", { value: true });
var vue_1 = require("vue");
var vue_router_1 = require("vue-router");
var vant_1 = require("vant");
var user_1 = require("../stores/user");
var router = (0, vue_router_1.useRouter)();
var userStore = (0, user_1.useUserStore)();
var username = (0, vue_1.ref)('');
var password = (0, vue_1.ref)('');
var loading = (0, vue_1.ref)(false);
function handleLogin() {
    return __awaiter(this, void 0, void 0, function () {
        var result, e_1;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    loading.value = true;
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, 4, 5]);
                    return [4 /*yield*/, userStore.login(username.value, password.value)];
                case 2:
                    result = _c.sent();
                    if (result.success) {
                        (0, vant_1.showToast)('登录成功');
                        router.replace('/');
                    }
                    else {
                        (0, vant_1.showToast)(result.error || '登录失败');
                    }
                    return [3 /*break*/, 5];
                case 3:
                    e_1 = _c.sent();
                    (0, vant_1.showToast)(((_b = (_a = e_1.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.error) || '登录失败');
                    return [3 /*break*/, 5];
                case 4:
                    loading.value = false;
                    return [7 /*endfinally*/];
                case 5: return [2 /*return*/];
            }
        });
    });
}
function goRegister() {
    router.push('/register');
}
var __VLS_ctx = __assign(__assign({}, {}), {});
var __VLS_components;
var __VLS_intrinsics;
var __VLS_directives;
/** @type {__VLS_StyleScopedClasses['logo']} */ ;
/** @type {__VLS_StyleScopedClasses['button-group']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "login-page" }));
/** @type {__VLS_StyleScopedClasses['login-page']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "logo" }));
/** @type {__VLS_StyleScopedClasses['logo']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "logo-icon" }));
/** @type {__VLS_StyleScopedClasses['logo-icon']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({});
var __VLS_0;
/** @ts-ignore @type {typeof __VLS_components.vanForm | typeof __VLS_components.VanForm | typeof __VLS_components.vanForm | typeof __VLS_components.VanForm} */
vanForm;
// @ts-ignore
var __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0(__assign({ 'onSubmit': {} })));
var __VLS_2 = __VLS_1.apply(void 0, __spreadArray([__assign({ 'onSubmit': {} })], __VLS_functionalComponentArgsRest(__VLS_1), false));
var __VLS_5;
var __VLS_6 = ({ submit: {} },
    { onSubmit: (__VLS_ctx.handleLogin) });
var __VLS_7 = __VLS_3.slots.default;
var __VLS_8;
/** @ts-ignore @type {typeof __VLS_components.vanCellGroup | typeof __VLS_components.VanCellGroup | typeof __VLS_components.vanCellGroup | typeof __VLS_components.VanCellGroup} */
vanCellGroup;
// @ts-ignore
var __VLS_9 = __VLS_asFunctionalComponent1(__VLS_8, new __VLS_8({
    inset: true,
}));
var __VLS_10 = __VLS_9.apply(void 0, __spreadArray([{
        inset: true,
    }], __VLS_functionalComponentArgsRest(__VLS_9), false));
var __VLS_13 = __VLS_11.slots.default;
var __VLS_14;
/** @ts-ignore @type {typeof __VLS_components.vanField | typeof __VLS_components.VanField} */
vanField;
// @ts-ignore
var __VLS_15 = __VLS_asFunctionalComponent1(__VLS_14, new __VLS_14({
    modelValue: (__VLS_ctx.username),
    name: "username",
    label: "用户名",
    placeholder: "请输入用户名",
    rules: ([{ required: true, message: '请输入用户名' }]),
}));
var __VLS_16 = __VLS_15.apply(void 0, __spreadArray([{
        modelValue: (__VLS_ctx.username),
        name: "username",
        label: "用户名",
        placeholder: "请输入用户名",
        rules: ([{ required: true, message: '请输入用户名' }]),
    }], __VLS_functionalComponentArgsRest(__VLS_15), false));
var __VLS_19;
/** @ts-ignore @type {typeof __VLS_components.vanField | typeof __VLS_components.VanField} */
vanField;
// @ts-ignore
var __VLS_20 = __VLS_asFunctionalComponent1(__VLS_19, new __VLS_19({
    modelValue: (__VLS_ctx.password),
    type: "password",
    name: "password",
    label: "密码",
    placeholder: "请输入密码",
    rules: ([{ required: true, message: '请输入密码' }]),
}));
var __VLS_21 = __VLS_20.apply(void 0, __spreadArray([{
        modelValue: (__VLS_ctx.password),
        type: "password",
        name: "password",
        label: "密码",
        placeholder: "请输入密码",
        rules: ([{ required: true, message: '请输入密码' }]),
    }], __VLS_functionalComponentArgsRest(__VLS_20), false));
// @ts-ignore
[handleLogin, username, password,];
var __VLS_11;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "button-group" }));
/** @type {__VLS_StyleScopedClasses['button-group']} */ ;
var __VLS_24;
/** @ts-ignore @type {typeof __VLS_components.vanButton | typeof __VLS_components.VanButton | typeof __VLS_components.vanButton | typeof __VLS_components.VanButton} */
vanButton;
// @ts-ignore
var __VLS_25 = __VLS_asFunctionalComponent1(__VLS_24, new __VLS_24({
    round: true,
    block: true,
    type: "primary",
    nativeType: "submit",
    loading: (__VLS_ctx.loading),
}));
var __VLS_26 = __VLS_25.apply(void 0, __spreadArray([{
        round: true,
        block: true,
        type: "primary",
        nativeType: "submit",
        loading: (__VLS_ctx.loading),
    }], __VLS_functionalComponentArgsRest(__VLS_25), false));
var __VLS_29 = __VLS_27.slots.default;
// @ts-ignore
[loading,];
var __VLS_27;
var __VLS_30;
/** @ts-ignore @type {typeof __VLS_components.vanButton | typeof __VLS_components.VanButton | typeof __VLS_components.vanButton | typeof __VLS_components.VanButton} */
vanButton;
// @ts-ignore
var __VLS_31 = __VLS_asFunctionalComponent1(__VLS_30, new __VLS_30(__assign({ 'onClick': {} }, { round: true, block: true, plain: true })));
var __VLS_32 = __VLS_31.apply(void 0, __spreadArray([__assign({ 'onClick': {} }, { round: true, block: true, plain: true })], __VLS_functionalComponentArgsRest(__VLS_31), false));
var __VLS_35;
var __VLS_36 = ({ click: {} },
    { onClick: (__VLS_ctx.goRegister) });
var __VLS_37 = __VLS_33.slots.default;
// @ts-ignore
[goRegister,];
var __VLS_33;
var __VLS_34;
// @ts-ignore
[];
var __VLS_3;
var __VLS_4;
// @ts-ignore
[];
var __VLS_export = (await Promise.resolve().then(function () { return require('vue'); })).defineComponent({});
exports.default = {};
