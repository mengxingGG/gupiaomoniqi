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
var api_1 = require("../api");
var vue_2 = require("vue");
exports.default = {};
var __VLS_self = (await Promise.resolve().then(function () { return require('vue'); })).defineComponent({
    name: 'Portfolio',
});
var __VLS_export = await (function () { return __awaiter(void 0, void 0, void 0, function () {
    function formatMoney(value) {
        return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function formatProfit(value) {
        var sign = value >= 0 ? '+' : '';
        return "".concat(sign).concat(formatMoney(value));
    }
    function formatTime(timestamp) {
        return new Date(timestamp).toLocaleString('zh-CN');
    }
    function loadData() {
        return __awaiter(this, void 0, void 0, function () {
            var _a, portfolioRes, positionsRes, ordersRes, e_1;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, Promise.all([
                                api_1.playerApi.getPortfolio(),
                                api_1.playerApi.getPositions(),
                                api_1.playerApi.getOrders(),
                            ])];
                    case 1:
                        _a = _b.sent(), portfolioRes = _a[0], positionsRes = _a[1], ordersRes = _a[2];
                        if (portfolioRes.success) {
                            portfolio.value = portfolioRes.data;
                        }
                        if (positionsRes.success) {
                            positions.value = positionsRes.data.positions || [];
                        }
                        if (ordersRes.success) {
                            orders.value = ordersRes.data.orders || [];
                        }
                        return [3 /*break*/, 3];
                    case 2:
                        e_1 = _b.sent();
                        (0, vant_1.showToast)('加载失败');
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        });
    }
    function onRefresh() {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, loadData()];
                    case 1:
                        _a.sent();
                        refreshing.value = false;
                        (0, vant_1.showToast)('刷新成功');
                        return [2 /*return*/];
                }
            });
        });
    }
    function goStock(code) {
        router.push("/stock/".concat(code));
    }
    var router, portfolio, positions, orders, refreshing, activeTab, profitClass, __VLS_ctx, __VLS_components, __VLS_intrinsics, __VLS_directives, __VLS_0, __VLS_1, __VLS_2, __VLS_5, __VLS_6, __VLS_7, __VLS_10, __VLS_11, __VLS_12, __VLS_13, __VLS_14, __VLS_15, __VLS_18, _loop_1, __VLS_22, __VLS_23, _i, _a, pos, __VLS_16, __VLS_28, __VLS_29, __VLS_30, __VLS_33, __VLS_34, __VLS_35, __VLS_38, _b, _c, order, __VLS_39, __VLS_40, __VLS_41, __VLS_44, __VLS_45, __VLS_46, __VLS_47, __VLS_48, __VLS_51, __VLS_49, __VLS_42, __VLS_36, __VLS_52, __VLS_53, __VLS_54, __VLS_8, __VLS_9, __VLS_57, __VLS_58, __VLS_59, __VLS_62, __VLS_63, __VLS_64, __VLS_65, __VLS_68, __VLS_66, __VLS_69, __VLS_70, __VLS_71, __VLS_74, __VLS_72, __VLS_75, __VLS_76, __VLS_77, __VLS_80, __VLS_78, __VLS_60;
    return __generator(this, function (_d) {
        switch (_d.label) {
            case 0:
                router = (0, vue_router_1.useRouter)();
                portfolio = (0, vue_1.ref)({
                    totalAssets: 0,
                    balance: 0,
                    marketValue: 0,
                    totalProfit: 0,
                });
                positions = (0, vue_1.ref)([]);
                orders = (0, vue_1.ref)([]);
                refreshing = (0, vue_1.ref)(false);
                activeTab = (0, vue_1.ref)(1);
                profitClass = (0, vue_2.computed)(function () {
                    return portfolio.value.totalProfit >= 0 ? 'profit' : 'loss';
                });
                (0, vue_1.onMounted)(function () {
                    loadData();
                });
                __VLS_ctx = __assign(__assign({}, {}), {});
                /** @type {__VLS_StyleScopedClasses['total-assets']} */ ;
                /** @type {__VLS_StyleScopedClasses['total-assets']} */ ;
                /** @type {__VLS_StyleScopedClasses['asset-row']} */ ;
                /** @type {__VLS_StyleScopedClasses['asset-row']} */ ;
                /** @type {__VLS_StyleScopedClasses['label']} */ ;
                /** @type {__VLS_StyleScopedClasses['asset-row']} */ ;
                /** @type {__VLS_StyleScopedClasses['value']} */ ;
                /** @type {__VLS_StyleScopedClasses['position-info']} */ ;
                /** @type {__VLS_StyleScopedClasses['position-info']} */ ;
                /** @type {__VLS_StyleScopedClasses['order-info']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "portfolio-page" }));
                /** @type {__VLS_StyleScopedClasses['portfolio-page']} */ ;
                /** @ts-ignore @type {typeof __VLS_components.vanNavBar | typeof __VLS_components.VanNavBar} */
                vanNavBar;
                __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0({
                    title: "我的持仓",
                    fixed: true,
                    placeholder: true,
                }));
                __VLS_2 = __VLS_1.apply(void 0, __spreadArray([{
                        title: "我的持仓",
                        fixed: true,
                        placeholder: true,
                    }], __VLS_functionalComponentArgsRest(__VLS_1), false));
                /** @ts-ignore @type {typeof __VLS_components.vanPullRefresh | typeof __VLS_components.VanPullRefresh | typeof __VLS_components.vanPullRefresh | typeof __VLS_components.VanPullRefresh} */
                vanPullRefresh;
                __VLS_6 = __VLS_asFunctionalComponent1(__VLS_5, new __VLS_5(__assign({ 'onRefresh': {} }, { modelValue: (__VLS_ctx.refreshing) })));
                __VLS_7 = __VLS_6.apply(void 0, __spreadArray([__assign({ 'onRefresh': {} }, { modelValue: (__VLS_ctx.refreshing) })], __VLS_functionalComponentArgsRest(__VLS_6), false));
                __VLS_11 = ({ refresh: {} },
                    { onRefresh: (__VLS_ctx.onRefresh) });
                __VLS_12 = __VLS_8.slots.default;
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "asset-card" }));
                /** @type {__VLS_StyleScopedClasses['asset-card']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "total-assets" }));
                /** @type {__VLS_StyleScopedClasses['total-assets']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "label" }));
                /** @type {__VLS_StyleScopedClasses['label']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "value" }));
                /** @type {__VLS_StyleScopedClasses['value']} */ ;
                (__VLS_ctx.formatMoney(__VLS_ctx.portfolio.totalAssets));
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "asset-row" }));
                /** @type {__VLS_StyleScopedClasses['asset-row']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "item" }));
                /** @type {__VLS_StyleScopedClasses['item']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "label" }));
                /** @type {__VLS_StyleScopedClasses['label']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "value" }));
                /** @type {__VLS_StyleScopedClasses['value']} */ ;
                (__VLS_ctx.formatMoney(__VLS_ctx.portfolio.balance));
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "item" }));
                /** @type {__VLS_StyleScopedClasses['item']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "label" }));
                /** @type {__VLS_StyleScopedClasses['label']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "value" }));
                /** @type {__VLS_StyleScopedClasses['value']} */ ;
                (__VLS_ctx.formatMoney(__VLS_ctx.portfolio.marketValue));
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "item" }));
                /** @type {__VLS_StyleScopedClasses['item']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "label" }));
                /** @type {__VLS_StyleScopedClasses['label']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)(__assign({ class: "value" }, { class: (__VLS_ctx.profitClass) }));
                /** @type {__VLS_StyleScopedClasses['value']} */ ;
                (__VLS_ctx.formatProfit(__VLS_ctx.portfolio.totalProfit));
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "section-title" }));
                /** @type {__VLS_StyleScopedClasses['section-title']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "position-list" }));
                /** @type {__VLS_StyleScopedClasses['position-list']} */ ;
                if (__VLS_ctx.positions.length > 0) {
                    __VLS_13 = void 0;
                    /** @ts-ignore @type {typeof __VLS_components.vanCellGroup | typeof __VLS_components.VanCellGroup | typeof __VLS_components.vanCellGroup | typeof __VLS_components.VanCellGroup} */
                    vanCellGroup;
                    __VLS_14 = __VLS_asFunctionalComponent1(__VLS_13, new __VLS_13({
                        inset: true,
                    }));
                    __VLS_15 = __VLS_14.apply(void 0, __spreadArray([{
                            inset: true,
                        }], __VLS_functionalComponentArgsRest(__VLS_14), false));
                    __VLS_18 = __VLS_16.slots.default;
                    _loop_1 = function (pos) {
                        var __VLS_19 = void 0;
                        /** @ts-ignore @type {typeof __VLS_components.vanCell | typeof __VLS_components.VanCell | typeof __VLS_components.vanCell | typeof __VLS_components.VanCell} */
                        vanCell;
                        // @ts-ignore
                        var __VLS_20 = __VLS_asFunctionalComponent1(__VLS_19, new __VLS_19(__assign({ 'onClick': {} }, { key: (pos.stock_code), title: (pos.stock_name), label: (pos.stock_code), isLink: true })));
                        var __VLS_21 = __VLS_20.apply(void 0, __spreadArray([__assign({ 'onClick': {} }, { key: (pos.stock_code), title: (pos.stock_name), label: (pos.stock_code), isLink: true })], __VLS_functionalComponentArgsRest(__VLS_20), false));
                        var __VLS_24 = void 0;
                        var __VLS_25 = ({ click: {} },
                            { onClick: function () {
                                    var _a = [];
                                    for (var _i = 0; _i < arguments.length; _i++) {
                                        _a[_i] = arguments[_i];
                                    }
                                    var $event = _a[0];
                                    if (!(__VLS_ctx.positions.length > 0))
                                        return;
                                    __VLS_ctx.goStock(pos.stock_code);
                                    // @ts-ignore
                                    [refreshing, onRefresh, formatMoney, formatMoney, formatMoney, portfolio, portfolio, portfolio, portfolio, profitClass, formatProfit, positions, positions, goStock,];
                                } });
                        var __VLS_26 = __VLS_22.slots.default;
                        {
                            var __VLS_27 = __VLS_22.slots.value;
                            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "position-info" }));
                            /** @type {__VLS_StyleScopedClasses['position-info']} */ ;
                            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
                            (pos.quantity);
                            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: (__VLS_ctx.profitClass) }));
                            (__VLS_ctx.formatMoney(pos.profit));
                            // @ts-ignore
                            [formatMoney, profitClass,];
                        }
                        // @ts-ignore
                        [];
                        // @ts-ignore
                        [];
                    };
                    for (_i = 0, _a = __VLS_vFor((__VLS_ctx.positions)); _i < _a.length; _i++) {
                        pos = _a[_i][0];
                        _loop_1(pos);
                    }
                    // @ts-ignore
                    [];
                }
                else {
                    __VLS_28 = void 0;
                    /** @ts-ignore @type {typeof __VLS_components.vanEmpty | typeof __VLS_components.VanEmpty} */
                    vanEmpty;
                    __VLS_29 = __VLS_asFunctionalComponent1(__VLS_28, new __VLS_28({
                        description: "暂无持仓",
                    }));
                    __VLS_30 = __VLS_29.apply(void 0, __spreadArray([{
                            description: "暂无持仓",
                        }], __VLS_functionalComponentArgsRest(__VLS_29), false));
                }
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "section-title" }));
                /** @type {__VLS_StyleScopedClasses['section-title']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "order-list" }));
                /** @type {__VLS_StyleScopedClasses['order-list']} */ ;
                if (__VLS_ctx.orders.length > 0) {
                    __VLS_33 = void 0;
                    /** @ts-ignore @type {typeof __VLS_components.vanCellGroup | typeof __VLS_components.VanCellGroup | typeof __VLS_components.vanCellGroup | typeof __VLS_components.VanCellGroup} */
                    vanCellGroup;
                    __VLS_34 = __VLS_asFunctionalComponent1(__VLS_33, new __VLS_33({
                        inset: true,
                    }));
                    __VLS_35 = __VLS_34.apply(void 0, __spreadArray([{
                            inset: true,
                        }], __VLS_functionalComponentArgsRest(__VLS_34), false));
                    __VLS_38 = __VLS_36.slots.default;
                    for (_b = 0, _c = __VLS_vFor((__VLS_ctx.orders)); _b < _c.length; _b++) {
                        order = _c[_b][0];
                        __VLS_39 = void 0;
                        /** @ts-ignore @type {typeof __VLS_components.vanCell | typeof __VLS_components.VanCell | typeof __VLS_components.vanCell | typeof __VLS_components.VanCell} */
                        vanCell;
                        __VLS_40 = __VLS_asFunctionalComponent1(__VLS_39, new __VLS_39({
                            key: (order.id),
                            title: (order.stock_name),
                            label: (__VLS_ctx.formatTime(order.created_at)),
                        }));
                        __VLS_41 = __VLS_40.apply(void 0, __spreadArray([{
                                key: (order.id),
                                title: (order.stock_name),
                                label: (__VLS_ctx.formatTime(order.created_at)),
                            }], __VLS_functionalComponentArgsRest(__VLS_40), false));
                        __VLS_44 = __VLS_42.slots.default;
                        {
                            __VLS_45 = __VLS_42.slots.value;
                            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "order-info" }));
                            /** @type {__VLS_StyleScopedClasses['order-info']} */ ;
                            __VLS_46 = void 0;
                            /** @ts-ignore @type {typeof __VLS_components.vanTag | typeof __VLS_components.VanTag | typeof __VLS_components.vanTag | typeof __VLS_components.VanTag} */
                            vanTag;
                            __VLS_47 = __VLS_asFunctionalComponent1(__VLS_46, new __VLS_46({
                                type: (order.type === 'buy' ? 'danger' : 'success'),
                            }));
                            __VLS_48 = __VLS_47.apply(void 0, __spreadArray([{
                                    type: (order.type === 'buy' ? 'danger' : 'success'),
                                }], __VLS_functionalComponentArgsRest(__VLS_47), false));
                            __VLS_51 = __VLS_49.slots.default;
                            (order.type === 'buy' ? '买入' : '卖出');
                            // @ts-ignore
                            [orders, orders, formatTime,];
                            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
                            (order.quantity);
                            // @ts-ignore
                            [];
                        }
                        // @ts-ignore
                        [];
                        // @ts-ignore
                        [];
                    }
                    // @ts-ignore
                    [];
                }
                else {
                    __VLS_52 = void 0;
                    /** @ts-ignore @type {typeof __VLS_components.vanEmpty | typeof __VLS_components.VanEmpty} */
                    vanEmpty;
                    __VLS_53 = __VLS_asFunctionalComponent1(__VLS_52, new __VLS_52({
                        description: "暂无委托",
                    }));
                    __VLS_54 = __VLS_53.apply(void 0, __spreadArray([{
                            description: "暂无委托",
                        }], __VLS_functionalComponentArgsRest(__VLS_53), false));
                }
                // @ts-ignore
                [];
                /** @ts-ignore @type {typeof __VLS_components.vanTabbar | typeof __VLS_components.VanTabbar | typeof __VLS_components.vanTabbar | typeof __VLS_components.VanTabbar} */
                vanTabbar;
                __VLS_58 = __VLS_asFunctionalComponent1(__VLS_57, new __VLS_57({
                    modelValue: (__VLS_ctx.activeTab),
                    fixed: true,
                }));
                __VLS_59 = __VLS_58.apply(void 0, __spreadArray([{
                        modelValue: (__VLS_ctx.activeTab),
                        fixed: true,
                    }], __VLS_functionalComponentArgsRest(__VLS_58), false));
                __VLS_62 = __VLS_60.slots.default;
                /** @ts-ignore @type {typeof __VLS_components.vanTabbarItem | typeof __VLS_components.VanTabbarItem | typeof __VLS_components.vanTabbarItem | typeof __VLS_components.VanTabbarItem} */
                vanTabbarItem;
                __VLS_64 = __VLS_asFunctionalComponent1(__VLS_63, new __VLS_63({
                    icon: "chart-trending-o",
                    to: "/",
                }));
                __VLS_65 = __VLS_64.apply(void 0, __spreadArray([{
                        icon: "chart-trending-o",
                        to: "/",
                    }], __VLS_functionalComponentArgsRest(__VLS_64), false));
                __VLS_68 = __VLS_66.slots.default;
                // @ts-ignore
                [activeTab,];
                /** @ts-ignore @type {typeof __VLS_components.vanTabbarItem | typeof __VLS_components.VanTabbarItem | typeof __VLS_components.vanTabbarItem | typeof __VLS_components.VanTabbarItem} */
                vanTabbarItem;
                __VLS_70 = __VLS_asFunctionalComponent1(__VLS_69, new __VLS_69({
                    icon: "balance-list-o",
                    to: "/portfolio",
                }));
                __VLS_71 = __VLS_70.apply(void 0, __spreadArray([{
                        icon: "balance-list-o",
                        to: "/portfolio",
                    }], __VLS_functionalComponentArgsRest(__VLS_70), false));
                __VLS_74 = __VLS_72.slots.default;
                // @ts-ignore
                [];
                /** @ts-ignore @type {typeof __VLS_components.vanTabbarItem | typeof __VLS_components.VanTabbarItem | typeof __VLS_components.vanTabbarItem | typeof __VLS_components.VanTabbarItem} */
                vanTabbarItem;
                __VLS_76 = __VLS_asFunctionalComponent1(__VLS_75, new __VLS_75({
                    icon: "user-o",
                    to: "/profile",
                }));
                __VLS_77 = __VLS_76.apply(void 0, __spreadArray([{
                        icon: "user-o",
                        to: "/profile",
                    }], __VLS_functionalComponentArgsRest(__VLS_76), false));
                __VLS_80 = __VLS_78.slots.default;
                // @ts-ignore
                [];
                // @ts-ignore
                [];
                // @ts-ignore
                [];
                return [4 /*yield*/, Promise.resolve().then(function () { return require('vue'); })];
            case 1: return [2 /*return*/, (_d.sent()).defineComponent({})];
        }
    });
}); })();
