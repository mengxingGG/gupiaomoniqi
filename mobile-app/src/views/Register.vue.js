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
var displayName = (0, vue_1.ref)('');
var password = (0, vue_1.ref)('');
var confirmPassword = (0, vue_1.ref)('');
var loading = (0, vue_1.ref)(false);
function validatePassword(value) {
    if (value.length < 8)
        return false;
    if (!/[A-Z]/.test(value))
        return false;
    if (!/[a-z]/.test(value))
        return false;
    if (!/[0-9]/.test(value))
        return false;
    return true;
}
function handleRegister() {
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
                    return [4 /*yield*/, userStore.register(username.value, password.value, displayName.value)];
                case 2:
                    result = _c.sent();
                    if (result.success) {
                        (0, vant_1.showToast)('注册成功');
                        router.replace('/');
                    }
                    else {
                        (0, vant_1.showToast)(result.error || '注册失败');
                    }
                    return [3 /*break*/, 5];
                case 3:
                    e_1 = _c.sent();
                    (0, vant_1.showToast)(((_b = (_a = e_1.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.error) || '注册失败');
                    return [3 /*break*/, 5];
                case 4:
                    loading.value = false;
                    return [7 /*endfinally*/];
                case 5: return [2 /*return*/];
            }
        });
    });
}
function goBack() {
    router.back();
}
var __VLS_ctx = __assign(__assign({}, {}), {});
var __VLS_components;
var __VLS_intrinsics;
var __VLS_directives;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "register-page" }));
/** @type {__VLS_StyleScopedClasses['register-page']} */ ;
var __VLS_0;
/** @ts-ignore @type {typeof __VLS_components.vanNavBar | typeof __VLS_components.VanNavBar} */
vanNavBar;
// @ts-ignore
var __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0(__assign({ 'onClickLeft': {} }, { title: "注册账号", leftArrow: true })));
var __VLS_2 = __VLS_1.apply(void 0, __spreadArray([__assign({ 'onClickLeft': {} }, { title: "注册账号", leftArrow: true })], __VLS_functionalComponentArgsRest(__VLS_1), false));
var __VLS_5;
var __VLS_6 = ({ clickLeft: {} },
    { onClickLeft: (__VLS_ctx.goBack) });
var __VLS_3;
var __VLS_4;
var __VLS_7;
/** @ts-ignore @type {typeof __VLS_components.vanForm | typeof __VLS_components.VanForm | typeof __VLS_components.vanForm | typeof __VLS_components.VanForm} */
vanForm;
// @ts-ignore
var __VLS_8 = __VLS_asFunctionalComponent1(__VLS_7, new __VLS_7(__assign({ 'onSubmit': {} })));
var __VLS_9 = __VLS_8.apply(void 0, __spreadArray([__assign({ 'onSubmit': {} })], __VLS_functionalComponentArgsRest(__VLS_8), false));
var __VLS_12;
var __VLS_13 = ({ submit: {} },
    { onSubmit: (__VLS_ctx.handleRegister) });
var __VLS_14 = __VLS_10.slots.default;
var __VLS_15;
/** @ts-ignore @type {typeof __VLS_components.vanCellGroup | typeof __VLS_components.VanCellGroup | typeof __VLS_components.vanCellGroup | typeof __VLS_components.VanCellGroup} */
vanCellGroup;
// @ts-ignore
var __VLS_16 = __VLS_asFunctionalComponent1(__VLS_15, new __VLS_15({
    inset: true,
}));
var __VLS_17 = __VLS_16.apply(void 0, __spreadArray([{
        inset: true,
    }], __VLS_functionalComponentArgsRest(__VLS_16), false));
var __VLS_20 = __VLS_18.slots.default;
var __VLS_21;
/** @ts-ignore @type {typeof __VLS_components.vanField | typeof __VLS_components.VanField} */
vanField;
// @ts-ignore
var __VLS_22 = __VLS_asFunctionalComponent1(__VLS_21, new __VLS_21({
    modelValue: (__VLS_ctx.username),
    name: "username",
    label: "用户名",
    placeholder: "3-20字符，字母数字下划线",
    rules: ([
        { required: true, message: '请输入用户名' },
        { pattern: /^[a-zA-Z0-9_]{3,20}$/, message: '用户名格式不正确' }
    ]),
}));
var __VLS_23 = __VLS_22.apply(void 0, __spreadArray([{
        modelValue: (__VLS_ctx.username),
        name: "username",
        label: "用户名",
        placeholder: "3-20字符，字母数字下划线",
        rules: ([
            { required: true, message: '请输入用户名' },
            { pattern: /^[a-zA-Z0-9_]{3,20}$/, message: '用户名格式不正确' }
        ]),
    }], __VLS_functionalComponentArgsRest(__VLS_22), false));
var __VLS_26;
/** @ts-ignore @type {typeof __VLS_components.vanField | typeof __VLS_components.VanField} */
vanField;
// @ts-ignore
var __VLS_27 = __VLS_asFunctionalComponent1(__VLS_26, new __VLS_26({
    modelValue: (__VLS_ctx.displayName),
    name: "displayName",
    label: "昵称",
    placeholder: "请输入昵称",
    rules: ([{ required: true, message: '请输入昵称' }]),
}));
var __VLS_28 = __VLS_27.apply(void 0, __spreadArray([{
        modelValue: (__VLS_ctx.displayName),
        name: "displayName",
        label: "昵称",
        placeholder: "请输入昵称",
        rules: ([{ required: true, message: '请输入昵称' }]),
    }], __VLS_functionalComponentArgsRest(__VLS_27), false));
var __VLS_31;
/** @ts-ignore @type {typeof __VLS_components.vanField | typeof __VLS_components.VanField} */
vanField;
// @ts-ignore
var __VLS_32 = __VLS_asFunctionalComponent1(__VLS_31, new __VLS_31({
    modelValue: (__VLS_ctx.password),
    type: "password",
    name: "password",
    label: "密码",
    placeholder: "至少8位，包含大小写和数字",
    rules: ([
        { required: true, message: '请输入密码' },
        { validator: __VLS_ctx.validatePassword, message: '密码需包含大小写字母和数字，至少8位' }
    ]),
}));
var __VLS_33 = __VLS_32.apply(void 0, __spreadArray([{
        modelValue: (__VLS_ctx.password),
        type: "password",
        name: "password",
        label: "密码",
        placeholder: "至少8位，包含大小写和数字",
        rules: ([
            { required: true, message: '请输入密码' },
            { validator: __VLS_ctx.validatePassword, message: '密码需包含大小写字母和数字，至少8位' }
        ]),
    }], __VLS_functionalComponentArgsRest(__VLS_32), false));
var __VLS_36;
/** @ts-ignore @type {typeof __VLS_components.vanField | typeof __VLS_components.VanField} */
vanField;
// @ts-ignore
var __VLS_37 = __VLS_asFunctionalComponent1(__VLS_36, new __VLS_36({
    modelValue: (__VLS_ctx.confirmPassword),
    type: "password",
    name: "confirmPassword",
    label: "确认密码",
    placeholder: "请再次输入密码",
    rules: ([
        { required: true, message: '请确认密码' },
        { validator: function (v) { return v === __VLS_ctx.password; }, message: '两次密码不一致' }
    ]),
}));
var __VLS_38 = __VLS_37.apply(void 0, __spreadArray([{
        modelValue: (__VLS_ctx.confirmPassword),
        type: "password",
        name: "confirmPassword",
        label: "确认密码",
        placeholder: "请再次输入密码",
        rules: ([
            { required: true, message: '请确认密码' },
            { validator: function (v) { return v === __VLS_ctx.password; }, message: '两次密码不一致' }
        ]),
    }], __VLS_functionalComponentArgsRest(__VLS_37), false));
// @ts-ignore
[goBack, handleRegister, username, displayName, password, password, validatePassword, confirmPassword,];
var __VLS_18;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "button-group" }));
/** @type {__VLS_StyleScopedClasses['button-group']} */ ;
var __VLS_41;
/** @ts-ignore @type {typeof __VLS_components.vanButton | typeof __VLS_components.VanButton | typeof __VLS_components.vanButton | typeof __VLS_components.VanButton} */
vanButton;
// @ts-ignore
var __VLS_42 = __VLS_asFunctionalComponent1(__VLS_41, new __VLS_41({
    round: true,
    block: true,
    type: "primary",
    nativeType: "submit",
    loading: (__VLS_ctx.loading),
}));
var __VLS_43 = __VLS_42.apply(void 0, __spreadArray([{
        round: true,
        block: true,
        type: "primary",
        nativeType: "submit",
        loading: (__VLS_ctx.loading),
    }], __VLS_functionalComponentArgsRest(__VLS_42), false));
var __VLS_46 = __VLS_44.slots.default;
// @ts-ignore
[loading,];
var __VLS_44;
// @ts-ignore
[];
var __VLS_10;
var __VLS_11;
// @ts-ignore
[];
var __VLS_export = (await Promise.resolve().then(function () { return require('vue'); })).defineComponent({});
exports.default = {};
