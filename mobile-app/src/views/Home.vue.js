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
var router = (0, vue_router_1.useRouter)();
var stocks = (0, vue_1.ref)([]);
var searchText = (0, vue_1.ref)('');
var loading = (0, vue_1.ref)(false);
var refreshing = (0, vue_1.ref)(false);
var finished = (0, vue_1.ref)(true);
var activeTab = (0, vue_1.ref)(0);
// 过滤股票
var filteredStocks = (0, vue_1.computed)(function () {
    if (!searchText.value)
        return stocks.value;
    var search = searchText.value.toLowerCase();
    return stocks.value.filter(function (s) {
        return s.code.toLowerCase().includes(search) ||
            s.name.toLowerCase().includes(search);
    });
});
// 格式化价格
function formatPrice(price) {
    return price.toFixed(2);
}
// 格式化涨跌幅
function formatChange(change) {
    var sign = change >= 0 ? '+' : '';
    return "".concat(sign).concat(change.toFixed(2), "%");
}
// 价格颜色
function priceClass(change) {
    if (change > 0)
        return 'up';
    if (change < 0)
        return 'down';
    return '';
}
// 加载股票数据
function loadStocks() {
    return __awaiter(this, void 0, void 0, function () {
        var res, e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, api_1.marketApi.getStocks()];
                case 1:
                    res = _a.sent();
                    if (res.success) {
                        stocks.value = res.data.stocks;
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
function onLoad() {
    // 已在 onMounted 加载
}
function onRefresh() {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, loadStocks()];
                case 1:
                    _a.sent();
                    refreshing.value = false;
                    (0, vant_1.showToast)('刷新成功');
                    return [2 /*return*/];
            }
        });
    });
}
function goDetail(code) {
    router.push("/stock/".concat(code));
}
function goProfile() {
    router.push('/profile');
}
(0, vue_1.onMounted)(function () {
    loadStocks();
});
var __VLS_ctx = __assign(__assign({}, {}), {});
var __VLS_components;
var __VLS_intrinsics;
var __VLS_directives;
/** @type {__VLS_StyleScopedClasses['stock-price']} */ ;
/** @type {__VLS_StyleScopedClasses['stock-price']} */ ;
/** @type {__VLS_StyleScopedClasses['stock-price']} */ ;
/** @type {__VLS_StyleScopedClasses['stock-price']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "home-page" }));
/** @type {__VLS_StyleScopedClasses['home-page']} */ ;
var __VLS_0;
/** @ts-ignore @type {typeof __VLS_components.vanNavBar | typeof __VLS_components.VanNavBar | typeof __VLS_components.vanNavBar | typeof __VLS_components.VanNavBar} */
vanNavBar;
// @ts-ignore
var __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0({
    title: "股票模拟器",
    fixed: true,
    placeholder: true,
}));
var __VLS_2 = __VLS_1.apply(void 0, __spreadArray([{
        title: "股票模拟器",
        fixed: true,
        placeholder: true,
    }], __VLS_functionalComponentArgsRest(__VLS_1), false));
var __VLS_5 = __VLS_3.slots.default;
{
    var __VLS_6 = __VLS_3.slots.right;
    var __VLS_7 = void 0;
    /** @ts-ignore @type {typeof __VLS_components.vanIcon | typeof __VLS_components.VanIcon} */
    vanIcon;
    // @ts-ignore
    var __VLS_8 = __VLS_asFunctionalComponent1(__VLS_7, new __VLS_7(__assign({ 'onClick': {} }, { name: "user-o", size: "20" })));
    var __VLS_9 = __VLS_8.apply(void 0, __spreadArray([__assign({ 'onClick': {} }, { name: "user-o", size: "20" })], __VLS_functionalComponentArgsRest(__VLS_8), false));
    var __VLS_12 = void 0;
    var __VLS_13 = ({ click: {} },
        { onClick: (__VLS_ctx.goProfile) });
    var __VLS_10;
    var __VLS_11;
    // @ts-ignore
    [goProfile,];
}
// @ts-ignore
[];
var __VLS_3;
var __VLS_14;
/** @ts-ignore @type {typeof __VLS_components.vanPullRefresh | typeof __VLS_components.VanPullRefresh | typeof __VLS_components.vanPullRefresh | typeof __VLS_components.VanPullRefresh} */
vanPullRefresh;
// @ts-ignore
var __VLS_15 = __VLS_asFunctionalComponent1(__VLS_14, new __VLS_14(__assign({ 'onRefresh': {} }, { modelValue: (__VLS_ctx.refreshing) })));
var __VLS_16 = __VLS_15.apply(void 0, __spreadArray([__assign({ 'onRefresh': {} }, { modelValue: (__VLS_ctx.refreshing) })], __VLS_functionalComponentArgsRest(__VLS_15), false));
var __VLS_19;
var __VLS_20 = ({ refresh: {} },
    { onRefresh: (__VLS_ctx.onRefresh) });
var __VLS_21 = __VLS_17.slots.default;
var __VLS_22;
/** @ts-ignore @type {typeof __VLS_components.vanList | typeof __VLS_components.VanList | typeof __VLS_components.vanList | typeof __VLS_components.VanList} */
vanList;
// @ts-ignore
var __VLS_23 = __VLS_asFunctionalComponent1(__VLS_22, new __VLS_22(__assign({ 'onLoad': {} }, { loading: (__VLS_ctx.loading), finished: (__VLS_ctx.finished), finishedText: "" })));
var __VLS_24 = __VLS_23.apply(void 0, __spreadArray([__assign({ 'onLoad': {} }, { loading: (__VLS_ctx.loading), finished: (__VLS_ctx.finished), finishedText: "" })], __VLS_functionalComponentArgsRest(__VLS_23), false));
var __VLS_27;
var __VLS_28 = ({ load: {} },
    { onLoad: (__VLS_ctx.onLoad) });
var __VLS_29 = __VLS_25.slots.default;
var __VLS_30;
/** @ts-ignore @type {typeof __VLS_components.vanSearch | typeof __VLS_components.VanSearch} */
vanSearch;
// @ts-ignore
var __VLS_31 = __VLS_asFunctionalComponent1(__VLS_30, new __VLS_30({
    modelValue: (__VLS_ctx.searchText),
    placeholder: "搜索股票代码或名称",
    shape: "round",
}));
var __VLS_32 = __VLS_31.apply(void 0, __spreadArray([{
        modelValue: (__VLS_ctx.searchText),
        placeholder: "搜索股票代码或名称",
        shape: "round",
    }], __VLS_functionalComponentArgsRest(__VLS_31), false));
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "stock-list" }));
/** @type {__VLS_StyleScopedClasses['stock-list']} */ ;
var _loop_1 = function (stock) {
    var __VLS_35 = void 0;
    /** @ts-ignore @type {typeof __VLS_components.vanCell | typeof __VLS_components.VanCell | typeof __VLS_components.vanCell | typeof __VLS_components.VanCell} */
    vanCell;
    // @ts-ignore
    var __VLS_36 = __VLS_asFunctionalComponent1(__VLS_35, new __VLS_35(__assign({ 'onClick': {} }, { key: (stock.code), title: (stock.name), label: (stock.code), isLink: true })));
    var __VLS_37 = __VLS_36.apply(void 0, __spreadArray([__assign({ 'onClick': {} }, { key: (stock.code), title: (stock.name), label: (stock.code), isLink: true })], __VLS_functionalComponentArgsRest(__VLS_36), false));
    var __VLS_40 = void 0;
    var __VLS_41 = ({ click: {} },
        { onClick: function () {
                var _a = [];
                for (var _i = 0; _i < arguments.length; _i++) {
                    _a[_i] = arguments[_i];
                }
                var $event = _a[0];
                __VLS_ctx.goDetail(stock.code);
                // @ts-ignore
                [refreshing, onRefresh, loading, finished, onLoad, searchText, filteredStocks, goDetail,];
            } });
    var __VLS_42 = __VLS_38.slots.default;
    {
        var __VLS_43 = __VLS_38.slots.value;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "stock-price" }, { class: (__VLS_ctx.priceClass(stock.change_percent)) }));
        /** @type {__VLS_StyleScopedClasses['stock-price']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "price" }));
        /** @type {__VLS_StyleScopedClasses['price']} */ ;
        (__VLS_ctx.formatPrice(stock.current_price));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)(__assign({ class: "change" }));
        /** @type {__VLS_StyleScopedClasses['change']} */ ;
        (__VLS_ctx.formatChange(stock.change_percent));
        // @ts-ignore
        [priceClass, formatPrice, formatChange,];
    }
    // @ts-ignore
    [];
    // @ts-ignore
    [];
};
var __VLS_38, __VLS_39;
for (var _i = 0, _a = __VLS_vFor((__VLS_ctx.filteredStocks)); _i < _a.length; _i++) {
    var stock = _a[_i][0];
    _loop_1(stock);
}
// @ts-ignore
[];
var __VLS_25;
var __VLS_26;
// @ts-ignore
[];
var __VLS_17;
var __VLS_18;
var __VLS_44;
/** @ts-ignore @type {typeof __VLS_components.vanTabbar | typeof __VLS_components.VanTabbar | typeof __VLS_components.vanTabbar | typeof __VLS_components.VanTabbar} */
vanTabbar;
// @ts-ignore
var __VLS_45 = __VLS_asFunctionalComponent1(__VLS_44, new __VLS_44({
    modelValue: (__VLS_ctx.activeTab),
    fixed: true,
}));
var __VLS_46 = __VLS_45.apply(void 0, __spreadArray([{
        modelValue: (__VLS_ctx.activeTab),
        fixed: true,
    }], __VLS_functionalComponentArgsRest(__VLS_45), false));
var __VLS_49 = __VLS_47.slots.default;
var __VLS_50;
/** @ts-ignore @type {typeof __VLS_components.vanTabbarItem | typeof __VLS_components.VanTabbarItem | typeof __VLS_components.vanTabbarItem | typeof __VLS_components.VanTabbarItem} */
vanTabbarItem;
// @ts-ignore
var __VLS_51 = __VLS_asFunctionalComponent1(__VLS_50, new __VLS_50({
    icon: "chart-trending-o",
    to: "/",
}));
var __VLS_52 = __VLS_51.apply(void 0, __spreadArray([{
        icon: "chart-trending-o",
        to: "/",
    }], __VLS_functionalComponentArgsRest(__VLS_51), false));
var __VLS_55 = __VLS_53.slots.default;
// @ts-ignore
[activeTab,];
var __VLS_53;
var __VLS_56;
/** @ts-ignore @type {typeof __VLS_components.vanTabbarItem | typeof __VLS_components.VanTabbarItem | typeof __VLS_components.vanTabbarItem | typeof __VLS_components.VanTabbarItem} */
vanTabbarItem;
// @ts-ignore
var __VLS_57 = __VLS_asFunctionalComponent1(__VLS_56, new __VLS_56({
    icon: "balance-list-o",
    to: "/portfolio",
}));
var __VLS_58 = __VLS_57.apply(void 0, __spreadArray([{
        icon: "balance-list-o",
        to: "/portfolio",
    }], __VLS_functionalComponentArgsRest(__VLS_57), false));
var __VLS_61 = __VLS_59.slots.default;
// @ts-ignore
[];
var __VLS_59;
var __VLS_62;
/** @ts-ignore @type {typeof __VLS_components.vanTabbarItem | typeof __VLS_components.VanTabbarItem | typeof __VLS_components.vanTabbarItem | typeof __VLS_components.VanTabbarItem} */
vanTabbarItem;
// @ts-ignore
var __VLS_63 = __VLS_asFunctionalComponent1(__VLS_62, new __VLS_62({
    icon: "user-o",
    to: "/profile",
}));
var __VLS_64 = __VLS_63.apply(void 0, __spreadArray([{
        icon: "user-o",
        to: "/profile",
    }], __VLS_functionalComponentArgsRest(__VLS_63), false));
var __VLS_67 = __VLS_65.slots.default;
// @ts-ignore
[];
var __VLS_65;
// @ts-ignore
[];
var __VLS_47;
// @ts-ignore
[];
var __VLS_export = (await Promise.resolve().then(function () { return require('vue'); })).defineComponent({});
exports.default = {};
