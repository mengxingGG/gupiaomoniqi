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
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
var vue_1 = require("vue");
var vue_router_1 = require("vue-router");
var vant_1 = require("vant");
var api_1 = require("../api");
var router = (0, vue_router_1.useRouter)();
var route = (0, vue_router_1.useRoute)();
var stock = (0, vue_1.ref)(null);
var tradeDialogVisible = (0, vue_1.ref)(false);
var tradeType = (0, vue_1.ref)('buy');
var tradeQuantity = (0, vue_1.ref)('');
var code = (0, vue_1.computed)(function () { return route.params.code; });
function formatPrice(price) {
    return price.toFixed(2);
}
function formatChange(change) {
    var sign = change >= 0 ? '+' : '';
    return "".concat(sign).concat(change.toFixed(2), "%");
}
function formatChangeAmount(amount) {
    var sign = amount >= 0 ? '+' : '';
    return "".concat(sign).concat(amount.toFixed(2));
}
function priceClass(change) {
    if (change > 0)
        return 'up';
    if (change < 0)
        return 'down';
    return '';
}
function loadStock() {
    return __awaiter(this, void 0, void 0, function () {
        var res, e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, api_1.marketApi.getStock(code.value)];
                case 1:
                    res = _a.sent();
                    if (res.success) {
                        stock.value = res.data.stock;
                    }
                    return [3 /*break*/, 3];
                case 2:
                    e_1 = _a.sent();
                    (0, vant_1.showToast)('加载失败');
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function showTradeDialog(type) {
    tradeType.value = type;
    tradeQuantity.value = '';
    tradeDialogVisible.value = true;
}
function handleTrade() {
    return __awaiter(this, void 0, void 0, function () {
        var quantity, api, res, e_2;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    quantity = parseInt(tradeQuantity.value);
                    if (!quantity || quantity <= 0) {
                        (0, vant_1.showToast)('请输入有效数量');
                        return [2 /*return*/];
                    }
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 6, , 7]);
                    api = tradeType.value === 'buy' ? api_1.tradeApi.buy : api_1.tradeApi.sell;
                    return [4 /*yield*/, api(code.value, quantity)];
                case 2:
                    res = _c.sent();
                    if (!res.success) return [3 /*break*/, 4];
                    (0, vant_1.showToast)(tradeType.value === 'buy' ? '买入成功' : '卖出成功');
                    return [4 /*yield*/, loadStock()];
                case 3:
                    _c.sent();
                    return [3 /*break*/, 5];
                case 4:
                    (0, vant_1.showToast)(res.error || '交易失败');
                    _c.label = 5;
                case 5: return [3 /*break*/, 7];
                case 6:
                    e_2 = _c.sent();
                    (0, vant_1.showToast)(((_b = (_a = e_2.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.error) || '交易失败');
                    return [3 /*break*/, 7];
                case 7: return [2 /*return*/];
            }
        });
    });
}
function goBack() {
    router.back();
}
(0, vue_1.onMounted)(function () {
    loadStock();
});
var __VLS_ctx = __assign(__assign({}, {}), {});
var __VLS_components;
var __VLS_intrinsics;
var __VLS_directives;
/** @type {__VLS_StyleScopedClasses['price-card']} */ ;
/** @type {__VLS_StyleScopedClasses['price-card']} */ ;
/** @type {__VLS_StyleScopedClasses['price-card']} */ ;
/** @type {__VLS_StyleScopedClasses['up']} */ ;
/** @type {__VLS_StyleScopedClasses['current-price']} */ ;
/** @type {__VLS_StyleScopedClasses['price-card']} */ ;
/** @type {__VLS_StyleScopedClasses['down']} */ ;
/** @type {__VLS_StyleScopedClasses['current-price']} */ ;
/** @type {__VLS_StyleScopedClasses['price-info']} */ ;
/** @type {__VLS_StyleScopedClasses['price-row']} */ ;
/** @type {__VLS_StyleScopedClasses['price-row']} */ ;
/** @type {__VLS_StyleScopedClasses['price-row']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "stock-detail" }));
/** @type {__VLS_StyleScopedClasses['stock-detail']} */ ;
var __VLS_0;
/** @ts-ignore @type {typeof __VLS_components.vanNavBar | typeof __VLS_components.VanNavBar} */
vanNavBar;
// @ts-ignore
var __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0(__assign({ 'onClickLeft': {} }, { title: (((_a = __VLS_ctx.stock) === null || _a === void 0 ? void 0 : _a.name) || '股票详情'), leftArrow: true, fixed: true, placeholder: true })));
var __VLS_2 = __VLS_1.apply(void 0, __spreadArray([__assign({ 'onClickLeft': {} }, { title: (((_b = __VLS_ctx.stock) === null || _b === void 0 ? void 0 : _b.name) || '股票详情'), leftArrow: true, fixed: true, placeholder: true })], __VLS_functionalComponentArgsRest(__VLS_1), false));
var __VLS_5;
var __VLS_6 = ({ clickLeft: {} },
    { onClickLeft: (__VLS_ctx.goBack) });
var __VLS_3;
var __VLS_4;
if (__VLS_ctx.stock) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "content" }));
    /** @type {__VLS_StyleScopedClasses['content']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "price-card" }, { class: (__VLS_ctx.priceClass(__VLS_ctx.stock.change_percent)) }));
    /** @type {__VLS_StyleScopedClasses['price-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "current-price" }));
    /** @type {__VLS_StyleScopedClasses['current-price']} */ ;
    (__VLS_ctx.formatPrice(__VLS_ctx.stock.current_price));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "price-info" }));
    /** @type {__VLS_StyleScopedClasses['price-info']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "change" }));
    /** @type {__VLS_StyleScopedClasses['change']} */ ;
    (__VLS_ctx.formatChange(__VLS_ctx.stock.change_percent));
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "change-amount" }));
    /** @type {__VLS_StyleScopedClasses['change-amount']} */ ;
    (__VLS_ctx.formatChangeAmount(__VLS_ctx.stock.change_amount));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "price-row" }));
    /** @type {__VLS_StyleScopedClasses['price-row']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "item" }));
    /** @type {__VLS_StyleScopedClasses['item']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "label" }));
    /** @type {__VLS_StyleScopedClasses['label']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "value" }));
    /** @type {__VLS_StyleScopedClasses['value']} */ ;
    (__VLS_ctx.formatPrice(__VLS_ctx.stock.open_price));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "item" }));
    /** @type {__VLS_StyleScopedClasses['item']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "label" }));
    /** @type {__VLS_StyleScopedClasses['label']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "value" }));
    /** @type {__VLS_StyleScopedClasses['value']} */ ;
    (__VLS_ctx.formatPrice(__VLS_ctx.stock.high_price));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "item" }));
    /** @type {__VLS_StyleScopedClasses['item']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "label" }));
    /** @type {__VLS_StyleScopedClasses['label']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "value" }));
    /** @type {__VLS_StyleScopedClasses['value']} */ ;
    (__VLS_ctx.formatPrice(__VLS_ctx.stock.low_price));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "item" }));
    /** @type {__VLS_StyleScopedClasses['item']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "label" }));
    /** @type {__VLS_StyleScopedClasses['label']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "value" }));
    /** @type {__VLS_StyleScopedClasses['value']} */ ;
    (__VLS_ctx.formatPrice(__VLS_ctx.stock.previous_close));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "trade-buttons" }));
    /** @type {__VLS_StyleScopedClasses['trade-buttons']} */ ;
    var __VLS_7 = void 0;
    /** @ts-ignore @type {typeof __VLS_components.vanButton | typeof __VLS_components.VanButton | typeof __VLS_components.vanButton | typeof __VLS_components.VanButton} */
    vanButton;
    // @ts-ignore
    var __VLS_8 = __VLS_asFunctionalComponent1(__VLS_7, new __VLS_7(__assign({ 'onClick': {} }, { type: "danger", block: true })));
    var __VLS_9 = __VLS_8.apply(void 0, __spreadArray([__assign({ 'onClick': {} }, { type: "danger", block: true })], __VLS_functionalComponentArgsRest(__VLS_8), false));
    var __VLS_12 = void 0;
    var __VLS_13 = ({ click: {} },
        { onClick: function () {
                var _a = [];
                for (var _i = 0; _i < arguments.length; _i++) {
                    _a[_i] = arguments[_i];
                }
                var $event = _a[0];
                if (!(__VLS_ctx.stock))
                    return;
                __VLS_ctx.showTradeDialog('buy');
                // @ts-ignore
                [stock, stock, stock, stock, stock, stock, stock, stock, stock, stock, goBack, priceClass, formatPrice, formatPrice, formatPrice, formatPrice, formatPrice, formatChange, formatChangeAmount, showTradeDialog,];
            } });
    var __VLS_14 = __VLS_10.slots.default;
    // @ts-ignore
    [];
    var __VLS_10;
    var __VLS_11;
    var __VLS_15 = void 0;
    /** @ts-ignore @type {typeof __VLS_components.vanButton | typeof __VLS_components.VanButton | typeof __VLS_components.vanButton | typeof __VLS_components.VanButton} */
    vanButton;
    // @ts-ignore
    var __VLS_16 = __VLS_asFunctionalComponent1(__VLS_15, new __VLS_15(__assign({ 'onClick': {} }, { type: "success", block: true })));
    var __VLS_17 = __VLS_16.apply(void 0, __spreadArray([__assign({ 'onClick': {} }, { type: "success", block: true })], __VLS_functionalComponentArgsRest(__VLS_16), false));
    var __VLS_20 = void 0;
    var __VLS_21 = ({ click: {} },
        { onClick: function () {
                var _a = [];
                for (var _i = 0; _i < arguments.length; _i++) {
                    _a[_i] = arguments[_i];
                }
                var $event = _a[0];
                if (!(__VLS_ctx.stock))
                    return;
                __VLS_ctx.showTradeDialog('sell');
                // @ts-ignore
                [showTradeDialog,];
            } });
    var __VLS_22 = __VLS_18.slots.default;
    // @ts-ignore
    [];
    var __VLS_18;
    var __VLS_19;
}
else {
    var __VLS_23 = void 0;
    /** @ts-ignore @type {typeof __VLS_components.vanLoading | typeof __VLS_components.VanLoading} */
    vanLoading;
    // @ts-ignore
    var __VLS_24 = __VLS_asFunctionalComponent1(__VLS_23, new __VLS_23(__assign({ class: "loading" })));
    var __VLS_25 = __VLS_24.apply(void 0, __spreadArray([__assign({ class: "loading" })], __VLS_functionalComponentArgsRest(__VLS_24), false));
    /** @type {__VLS_StyleScopedClasses['loading']} */ ;
}
var __VLS_28;
/** @ts-ignore @type {typeof __VLS_components.vanDialog | typeof __VLS_components.VanDialog | typeof __VLS_components.vanDialog | typeof __VLS_components.VanDialog} */
vanDialog;
// @ts-ignore
var __VLS_29 = __VLS_asFunctionalComponent1(__VLS_28, new __VLS_28(__assign({ 'onConfirm': {} }, { show: (__VLS_ctx.tradeDialogVisible), title: (__VLS_ctx.tradeType === 'buy' ? '买入' : '卖出'), showCancelButton: true })));
var __VLS_30 = __VLS_29.apply(void 0, __spreadArray([__assign({ 'onConfirm': {} }, { show: (__VLS_ctx.tradeDialogVisible), title: (__VLS_ctx.tradeType === 'buy' ? '买入' : '卖出'), showCancelButton: true })], __VLS_functionalComponentArgsRest(__VLS_29), false));
var __VLS_33;
var __VLS_34 = ({ confirm: {} },
    { onConfirm: (__VLS_ctx.handleTrade) });
var __VLS_35 = __VLS_31.slots.default;
var __VLS_36;
/** @ts-ignore @type {typeof __VLS_components.vanField | typeof __VLS_components.VanField} */
vanField;
// @ts-ignore
var __VLS_37 = __VLS_asFunctionalComponent1(__VLS_36, new __VLS_36({
    modelValue: (__VLS_ctx.tradeQuantity),
    type: "number",
    label: "数量",
    placeholder: "请输入交易数量",
}));
var __VLS_38 = __VLS_37.apply(void 0, __spreadArray([{
        modelValue: (__VLS_ctx.tradeQuantity),
        type: "number",
        label: "数量",
        placeholder: "请输入交易数量",
    }], __VLS_functionalComponentArgsRest(__VLS_37), false));
// @ts-ignore
[tradeDialogVisible, tradeType, handleTrade, tradeQuantity,];
var __VLS_31;
var __VLS_32;
// @ts-ignore
[];
var __VLS_export = (await Promise.resolve().then(function () { return require('vue'); })).defineComponent({});
exports.default = {};
