"use strict";
var SavigRuntimeBundle = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // ../../node_modules/.pnpm/polygon-clipping@0.15.7/node_modules/polygon-clipping/dist/polygon-clipping.umd.js
  var require_polygon_clipping_umd = __commonJS({
    "../../node_modules/.pnpm/polygon-clipping@0.15.7/node_modules/polygon-clipping/dist/polygon-clipping.umd.js"(exports, module) {
      (function(global, factory) {
        typeof exports === "object" && typeof module !== "undefined" ? module.exports = factory() : typeof define === "function" && define.amd ? define(factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, global.polygonClipping = factory());
      })(exports, (function() {
        "use strict";
        function __generator(thisArg, body) {
          var _ = {
            label: 0,
            sent: function() {
              if (t[0] & 1) throw t[1];
              return t[1];
            },
            trys: [],
            ops: []
          }, f, y, t, g;
          return g = {
            next: verb(0),
            "throw": verb(1),
            "return": verb(2)
          }, typeof Symbol === "function" && (g[Symbol.iterator] = function() {
            return this;
          }), g;
          function verb(n) {
            return function(v) {
              return step([n, v]);
            };
          }
          function step(op) {
            if (f) throw new TypeError("Generator is already executing.");
            while (_) try {
              if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
              if (y = 0, t) op = [op[0] & 2, t.value];
              switch (op[0]) {
                case 0:
                case 1:
                  t = op;
                  break;
                case 4:
                  _.label++;
                  return {
                    value: op[1],
                    done: false
                  };
                case 5:
                  _.label++;
                  y = op[1];
                  op = [0];
                  continue;
                case 7:
                  op = _.ops.pop();
                  _.trys.pop();
                  continue;
                default:
                  if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
                    _ = 0;
                    continue;
                  }
                  if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
                    _.label = op[1];
                    break;
                  }
                  if (op[0] === 6 && _.label < t[1]) {
                    _.label = t[1];
                    t = op;
                    break;
                  }
                  if (t && _.label < t[2]) {
                    _.label = t[2];
                    _.ops.push(op);
                    break;
                  }
                  if (t[2]) _.ops.pop();
                  _.trys.pop();
                  continue;
              }
              op = body.call(thisArg, _);
            } catch (e) {
              op = [6, e];
              y = 0;
            } finally {
              f = t = 0;
            }
            if (op[0] & 5) throw op[1];
            return {
              value: op[0] ? op[1] : void 0,
              done: true
            };
          }
        }
        var Node2 = (
          /** @class */
          /* @__PURE__ */ (function() {
            function Node3(key, data) {
              this.next = null;
              this.key = key;
              this.data = data;
              this.left = null;
              this.right = null;
            }
            return Node3;
          })()
        );
        function DEFAULT_COMPARE(a, b) {
          return a > b ? 1 : a < b ? -1 : 0;
        }
        function splay(i, t, comparator) {
          var N = new Node2(null, null);
          var l = N;
          var r = N;
          while (true) {
            var cmp2 = comparator(i, t.key);
            if (cmp2 < 0) {
              if (t.left === null) break;
              if (comparator(i, t.left.key) < 0) {
                var y = t.left;
                t.left = y.right;
                y.right = t;
                t = y;
                if (t.left === null) break;
              }
              r.left = t;
              r = t;
              t = t.left;
            } else if (cmp2 > 0) {
              if (t.right === null) break;
              if (comparator(i, t.right.key) > 0) {
                var y = t.right;
                t.right = y.left;
                y.left = t;
                t = y;
                if (t.right === null) break;
              }
              l.right = t;
              l = t;
              t = t.right;
            } else break;
          }
          l.right = t.left;
          r.left = t.right;
          t.left = N.right;
          t.right = N.left;
          return t;
        }
        function insert(i, data, t, comparator) {
          var node = new Node2(i, data);
          if (t === null) {
            node.left = node.right = null;
            return node;
          }
          t = splay(i, t, comparator);
          var cmp2 = comparator(i, t.key);
          if (cmp2 < 0) {
            node.left = t.left;
            node.right = t;
            t.left = null;
          } else if (cmp2 >= 0) {
            node.right = t.right;
            node.left = t;
            t.right = null;
          }
          return node;
        }
        function split(key, v, comparator) {
          var left = null;
          var right = null;
          if (v) {
            v = splay(key, v, comparator);
            var cmp2 = comparator(v.key, key);
            if (cmp2 === 0) {
              left = v.left;
              right = v.right;
            } else if (cmp2 < 0) {
              right = v.right;
              v.right = null;
              left = v;
            } else {
              left = v.left;
              v.left = null;
              right = v;
            }
          }
          return {
            left,
            right
          };
        }
        function merge(left, right, comparator) {
          if (right === null) return left;
          if (left === null) return right;
          right = splay(left.key, right, comparator);
          right.left = left;
          return right;
        }
        function printRow(root, prefix, isTail, out, printNode) {
          if (root) {
            out("" + prefix + (isTail ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ") + printNode(root) + "\n");
            var indent = prefix + (isTail ? "    " : "\u2502   ");
            if (root.left) printRow(root.left, indent, false, out, printNode);
            if (root.right) printRow(root.right, indent, true, out, printNode);
          }
        }
        var Tree = (
          /** @class */
          (function() {
            function Tree2(comparator) {
              if (comparator === void 0) {
                comparator = DEFAULT_COMPARE;
              }
              this._root = null;
              this._size = 0;
              this._comparator = comparator;
            }
            Tree2.prototype.insert = function(key, data) {
              this._size++;
              return this._root = insert(key, data, this._root, this._comparator);
            };
            Tree2.prototype.add = function(key, data) {
              var node = new Node2(key, data);
              if (this._root === null) {
                node.left = node.right = null;
                this._size++;
                this._root = node;
              }
              var comparator = this._comparator;
              var t = splay(key, this._root, comparator);
              var cmp2 = comparator(key, t.key);
              if (cmp2 === 0) this._root = t;
              else {
                if (cmp2 < 0) {
                  node.left = t.left;
                  node.right = t;
                  t.left = null;
                } else if (cmp2 > 0) {
                  node.right = t.right;
                  node.left = t;
                  t.right = null;
                }
                this._size++;
                this._root = node;
              }
              return this._root;
            };
            Tree2.prototype.remove = function(key) {
              this._root = this._remove(key, this._root, this._comparator);
            };
            Tree2.prototype._remove = function(i, t, comparator) {
              var x;
              if (t === null) return null;
              t = splay(i, t, comparator);
              var cmp2 = comparator(i, t.key);
              if (cmp2 === 0) {
                if (t.left === null) {
                  x = t.right;
                } else {
                  x = splay(i, t.left, comparator);
                  x.right = t.right;
                }
                this._size--;
                return x;
              }
              return t;
            };
            Tree2.prototype.pop = function() {
              var node = this._root;
              if (node) {
                while (node.left) node = node.left;
                this._root = splay(node.key, this._root, this._comparator);
                this._root = this._remove(node.key, this._root, this._comparator);
                return {
                  key: node.key,
                  data: node.data
                };
              }
              return null;
            };
            Tree2.prototype.findStatic = function(key) {
              var current2 = this._root;
              var compare = this._comparator;
              while (current2) {
                var cmp2 = compare(key, current2.key);
                if (cmp2 === 0) return current2;
                else if (cmp2 < 0) current2 = current2.left;
                else current2 = current2.right;
              }
              return null;
            };
            Tree2.prototype.find = function(key) {
              if (this._root) {
                this._root = splay(key, this._root, this._comparator);
                if (this._comparator(key, this._root.key) !== 0) return null;
              }
              return this._root;
            };
            Tree2.prototype.contains = function(key) {
              var current2 = this._root;
              var compare = this._comparator;
              while (current2) {
                var cmp2 = compare(key, current2.key);
                if (cmp2 === 0) return true;
                else if (cmp2 < 0) current2 = current2.left;
                else current2 = current2.right;
              }
              return false;
            };
            Tree2.prototype.forEach = function(visitor, ctx) {
              var current2 = this._root;
              var Q = [];
              var done = false;
              while (!done) {
                if (current2 !== null) {
                  Q.push(current2);
                  current2 = current2.left;
                } else {
                  if (Q.length !== 0) {
                    current2 = Q.pop();
                    visitor.call(ctx, current2);
                    current2 = current2.right;
                  } else done = true;
                }
              }
              return this;
            };
            Tree2.prototype.range = function(low, high, fn, ctx) {
              var Q = [];
              var compare = this._comparator;
              var node = this._root;
              var cmp2;
              while (Q.length !== 0 || node) {
                if (node) {
                  Q.push(node);
                  node = node.left;
                } else {
                  node = Q.pop();
                  cmp2 = compare(node.key, high);
                  if (cmp2 > 0) {
                    break;
                  } else if (compare(node.key, low) >= 0) {
                    if (fn.call(ctx, node)) return this;
                  }
                  node = node.right;
                }
              }
              return this;
            };
            Tree2.prototype.keys = function() {
              var keys = [];
              this.forEach(function(_a) {
                var key = _a.key;
                return keys.push(key);
              });
              return keys;
            };
            Tree2.prototype.values = function() {
              var values = [];
              this.forEach(function(_a) {
                var data = _a.data;
                return values.push(data);
              });
              return values;
            };
            Tree2.prototype.min = function() {
              if (this._root) return this.minNode(this._root).key;
              return null;
            };
            Tree2.prototype.max = function() {
              if (this._root) return this.maxNode(this._root).key;
              return null;
            };
            Tree2.prototype.minNode = function(t) {
              if (t === void 0) {
                t = this._root;
              }
              if (t) while (t.left) t = t.left;
              return t;
            };
            Tree2.prototype.maxNode = function(t) {
              if (t === void 0) {
                t = this._root;
              }
              if (t) while (t.right) t = t.right;
              return t;
            };
            Tree2.prototype.at = function(index2) {
              var current2 = this._root;
              var done = false;
              var i = 0;
              var Q = [];
              while (!done) {
                if (current2) {
                  Q.push(current2);
                  current2 = current2.left;
                } else {
                  if (Q.length > 0) {
                    current2 = Q.pop();
                    if (i === index2) return current2;
                    i++;
                    current2 = current2.right;
                  } else done = true;
                }
              }
              return null;
            };
            Tree2.prototype.next = function(d) {
              var root = this._root;
              var successor = null;
              if (d.right) {
                successor = d.right;
                while (successor.left) successor = successor.left;
                return successor;
              }
              var comparator = this._comparator;
              while (root) {
                var cmp2 = comparator(d.key, root.key);
                if (cmp2 === 0) break;
                else if (cmp2 < 0) {
                  successor = root;
                  root = root.left;
                } else root = root.right;
              }
              return successor;
            };
            Tree2.prototype.prev = function(d) {
              var root = this._root;
              var predecessor = null;
              if (d.left !== null) {
                predecessor = d.left;
                while (predecessor.right) predecessor = predecessor.right;
                return predecessor;
              }
              var comparator = this._comparator;
              while (root) {
                var cmp2 = comparator(d.key, root.key);
                if (cmp2 === 0) break;
                else if (cmp2 < 0) root = root.left;
                else {
                  predecessor = root;
                  root = root.right;
                }
              }
              return predecessor;
            };
            Tree2.prototype.clear = function() {
              this._root = null;
              this._size = 0;
              return this;
            };
            Tree2.prototype.toList = function() {
              return toList(this._root);
            };
            Tree2.prototype.load = function(keys, values, presort) {
              if (values === void 0) {
                values = [];
              }
              if (presort === void 0) {
                presort = false;
              }
              var size = keys.length;
              var comparator = this._comparator;
              if (presort) sort(keys, values, 0, size - 1, comparator);
              if (this._root === null) {
                this._root = loadRecursive(keys, values, 0, size);
                this._size = size;
              } else {
                var mergedList = mergeLists(this.toList(), createList(keys, values), comparator);
                size = this._size + size;
                this._root = sortedListToBST({
                  head: mergedList
                }, 0, size);
              }
              return this;
            };
            Tree2.prototype.isEmpty = function() {
              return this._root === null;
            };
            Object.defineProperty(Tree2.prototype, "size", {
              get: function() {
                return this._size;
              },
              enumerable: true,
              configurable: true
            });
            Object.defineProperty(Tree2.prototype, "root", {
              get: function() {
                return this._root;
              },
              enumerable: true,
              configurable: true
            });
            Tree2.prototype.toString = function(printNode) {
              if (printNode === void 0) {
                printNode = function(n) {
                  return String(n.key);
                };
              }
              var out = [];
              printRow(this._root, "", true, function(v) {
                return out.push(v);
              }, printNode);
              return out.join("");
            };
            Tree2.prototype.update = function(key, newKey, newData) {
              var comparator = this._comparator;
              var _a = split(key, this._root, comparator), left = _a.left, right = _a.right;
              if (comparator(key, newKey) < 0) {
                right = insert(newKey, newData, right, comparator);
              } else {
                left = insert(newKey, newData, left, comparator);
              }
              this._root = merge(left, right, comparator);
            };
            Tree2.prototype.split = function(key) {
              return split(key, this._root, this._comparator);
            };
            Tree2.prototype[Symbol.iterator] = function() {
              var current2, Q, done;
              return __generator(this, function(_a) {
                switch (_a.label) {
                  case 0:
                    current2 = this._root;
                    Q = [];
                    done = false;
                    _a.label = 1;
                  case 1:
                    if (!!done) return [3, 6];
                    if (!(current2 !== null)) return [3, 2];
                    Q.push(current2);
                    current2 = current2.left;
                    return [3, 5];
                  case 2:
                    if (!(Q.length !== 0)) return [3, 4];
                    current2 = Q.pop();
                    return [4, current2];
                  case 3:
                    _a.sent();
                    current2 = current2.right;
                    return [3, 5];
                  case 4:
                    done = true;
                    _a.label = 5;
                  case 5:
                    return [3, 1];
                  case 6:
                    return [
                      2
                      /*return*/
                    ];
                }
              });
            };
            return Tree2;
          })()
        );
        function loadRecursive(keys, values, start, end) {
          var size = end - start;
          if (size > 0) {
            var middle = start + Math.floor(size / 2);
            var key = keys[middle];
            var data = values[middle];
            var node = new Node2(key, data);
            node.left = loadRecursive(keys, values, start, middle);
            node.right = loadRecursive(keys, values, middle + 1, end);
            return node;
          }
          return null;
        }
        function createList(keys, values) {
          var head = new Node2(null, null);
          var p = head;
          for (var i = 0; i < keys.length; i++) {
            p = p.next = new Node2(keys[i], values[i]);
          }
          p.next = null;
          return head.next;
        }
        function toList(root) {
          var current2 = root;
          var Q = [];
          var done = false;
          var head = new Node2(null, null);
          var p = head;
          while (!done) {
            if (current2) {
              Q.push(current2);
              current2 = current2.left;
            } else {
              if (Q.length > 0) {
                current2 = p = p.next = Q.pop();
                current2 = current2.right;
              } else done = true;
            }
          }
          p.next = null;
          return head.next;
        }
        function sortedListToBST(list, start, end) {
          var size = end - start;
          if (size > 0) {
            var middle = start + Math.floor(size / 2);
            var left = sortedListToBST(list, start, middle);
            var root = list.head;
            root.left = left;
            list.head = list.head.next;
            root.right = sortedListToBST(list, middle + 1, end);
            return root;
          }
          return null;
        }
        function mergeLists(l1, l2, compare) {
          var head = new Node2(null, null);
          var p = head;
          var p1 = l1;
          var p2 = l2;
          while (p1 !== null && p2 !== null) {
            if (compare(p1.key, p2.key) < 0) {
              p.next = p1;
              p1 = p1.next;
            } else {
              p.next = p2;
              p2 = p2.next;
            }
            p = p.next;
          }
          if (p1 !== null) {
            p.next = p1;
          } else if (p2 !== null) {
            p.next = p2;
          }
          return head.next;
        }
        function sort(keys, values, left, right, compare) {
          if (left >= right) return;
          var pivot = keys[left + right >> 1];
          var i = left - 1;
          var j = right + 1;
          while (true) {
            do
              i++;
            while (compare(keys[i], pivot) < 0);
            do
              j--;
            while (compare(keys[j], pivot) > 0);
            if (i >= j) break;
            var tmp = keys[i];
            keys[i] = keys[j];
            keys[j] = tmp;
            tmp = values[i];
            values[i] = values[j];
            values[j] = tmp;
          }
          sort(keys, values, left, j, compare);
          sort(keys, values, j + 1, right, compare);
        }
        const isInBbox = (bbox, point) => {
          return bbox.ll.x <= point.x && point.x <= bbox.ur.x && bbox.ll.y <= point.y && point.y <= bbox.ur.y;
        };
        const getBboxOverlap = (b1, b2) => {
          if (b2.ur.x < b1.ll.x || b1.ur.x < b2.ll.x || b2.ur.y < b1.ll.y || b1.ur.y < b2.ll.y) return null;
          const lowerX = b1.ll.x < b2.ll.x ? b2.ll.x : b1.ll.x;
          const upperX = b1.ur.x < b2.ur.x ? b1.ur.x : b2.ur.x;
          const lowerY = b1.ll.y < b2.ll.y ? b2.ll.y : b1.ll.y;
          const upperY = b1.ur.y < b2.ur.y ? b1.ur.y : b2.ur.y;
          return {
            ll: {
              x: lowerX,
              y: lowerY
            },
            ur: {
              x: upperX,
              y: upperY
            }
          };
        };
        let epsilon$1 = Number.EPSILON;
        if (epsilon$1 === void 0) epsilon$1 = Math.pow(2, -52);
        const EPSILON_SQ = epsilon$1 * epsilon$1;
        const cmp = (a, b) => {
          if (-epsilon$1 < a && a < epsilon$1) {
            if (-epsilon$1 < b && b < epsilon$1) {
              return 0;
            }
          }
          const ab = a - b;
          if (ab * ab < EPSILON_SQ * a * b) {
            return 0;
          }
          return a < b ? -1 : 1;
        };
        class PtRounder {
          constructor() {
            this.reset();
          }
          reset() {
            this.xRounder = new CoordRounder();
            this.yRounder = new CoordRounder();
          }
          round(x, y) {
            return {
              x: this.xRounder.round(x),
              y: this.yRounder.round(y)
            };
          }
        }
        class CoordRounder {
          constructor() {
            this.tree = new Tree();
            this.round(0);
          }
          // Note: this can rounds input values backwards or forwards.
          //       You might ask, why not restrict this to just rounding
          //       forwards? Wouldn't that allow left endpoints to always
          //       remain left endpoints during splitting (never change to
          //       right). No - it wouldn't, because we snap intersections
          //       to endpoints (to establish independence from the segment
          //       angle for t-intersections).
          round(coord) {
            const node = this.tree.add(coord);
            const prevNode = this.tree.prev(node);
            if (prevNode !== null && cmp(node.key, prevNode.key) === 0) {
              this.tree.remove(coord);
              return prevNode.key;
            }
            const nextNode = this.tree.next(node);
            if (nextNode !== null && cmp(node.key, nextNode.key) === 0) {
              this.tree.remove(coord);
              return nextNode.key;
            }
            return coord;
          }
        }
        const rounder = new PtRounder();
        const epsilon = 11102230246251565e-32;
        const splitter = 134217729;
        const resulterrbound = (3 + 8 * epsilon) * epsilon;
        function sum(elen, e, flen, f, h) {
          let Q, Qnew, hh, bvirt;
          let enow = e[0];
          let fnow = f[0];
          let eindex = 0;
          let findex = 0;
          if (fnow > enow === fnow > -enow) {
            Q = enow;
            enow = e[++eindex];
          } else {
            Q = fnow;
            fnow = f[++findex];
          }
          let hindex = 0;
          if (eindex < elen && findex < flen) {
            if (fnow > enow === fnow > -enow) {
              Qnew = enow + Q;
              hh = Q - (Qnew - enow);
              enow = e[++eindex];
            } else {
              Qnew = fnow + Q;
              hh = Q - (Qnew - fnow);
              fnow = f[++findex];
            }
            Q = Qnew;
            if (hh !== 0) {
              h[hindex++] = hh;
            }
            while (eindex < elen && findex < flen) {
              if (fnow > enow === fnow > -enow) {
                Qnew = Q + enow;
                bvirt = Qnew - Q;
                hh = Q - (Qnew - bvirt) + (enow - bvirt);
                enow = e[++eindex];
              } else {
                Qnew = Q + fnow;
                bvirt = Qnew - Q;
                hh = Q - (Qnew - bvirt) + (fnow - bvirt);
                fnow = f[++findex];
              }
              Q = Qnew;
              if (hh !== 0) {
                h[hindex++] = hh;
              }
            }
          }
          while (eindex < elen) {
            Qnew = Q + enow;
            bvirt = Qnew - Q;
            hh = Q - (Qnew - bvirt) + (enow - bvirt);
            enow = e[++eindex];
            Q = Qnew;
            if (hh !== 0) {
              h[hindex++] = hh;
            }
          }
          while (findex < flen) {
            Qnew = Q + fnow;
            bvirt = Qnew - Q;
            hh = Q - (Qnew - bvirt) + (fnow - bvirt);
            fnow = f[++findex];
            Q = Qnew;
            if (hh !== 0) {
              h[hindex++] = hh;
            }
          }
          if (Q !== 0 || hindex === 0) {
            h[hindex++] = Q;
          }
          return hindex;
        }
        function estimate(elen, e) {
          let Q = e[0];
          for (let i = 1; i < elen; i++) Q += e[i];
          return Q;
        }
        function vec(n) {
          return new Float64Array(n);
        }
        const ccwerrboundA = (3 + 16 * epsilon) * epsilon;
        const ccwerrboundB = (2 + 12 * epsilon) * epsilon;
        const ccwerrboundC = (9 + 64 * epsilon) * epsilon * epsilon;
        const B = vec(4);
        const C1 = vec(8);
        const C2 = vec(12);
        const D = vec(16);
        const u = vec(4);
        function orient2dadapt(ax, ay, bx, by, cx, cy, detsum) {
          let acxtail, acytail, bcxtail, bcytail;
          let bvirt, c, ahi, alo, bhi, blo, _i, _j, _0, s1, s0, t1, t0, u3;
          const acx = ax - cx;
          const bcx = bx - cx;
          const acy = ay - cy;
          const bcy = by - cy;
          s1 = acx * bcy;
          c = splitter * acx;
          ahi = c - (c - acx);
          alo = acx - ahi;
          c = splitter * bcy;
          bhi = c - (c - bcy);
          blo = bcy - bhi;
          s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
          t1 = acy * bcx;
          c = splitter * acy;
          ahi = c - (c - acy);
          alo = acy - ahi;
          c = splitter * bcx;
          bhi = c - (c - bcx);
          blo = bcx - bhi;
          t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
          _i = s0 - t0;
          bvirt = s0 - _i;
          B[0] = s0 - (_i + bvirt) + (bvirt - t0);
          _j = s1 + _i;
          bvirt = _j - s1;
          _0 = s1 - (_j - bvirt) + (_i - bvirt);
          _i = _0 - t1;
          bvirt = _0 - _i;
          B[1] = _0 - (_i + bvirt) + (bvirt - t1);
          u3 = _j + _i;
          bvirt = u3 - _j;
          B[2] = _j - (u3 - bvirt) + (_i - bvirt);
          B[3] = u3;
          let det = estimate(4, B);
          let errbound = ccwerrboundB * detsum;
          if (det >= errbound || -det >= errbound) {
            return det;
          }
          bvirt = ax - acx;
          acxtail = ax - (acx + bvirt) + (bvirt - cx);
          bvirt = bx - bcx;
          bcxtail = bx - (bcx + bvirt) + (bvirt - cx);
          bvirt = ay - acy;
          acytail = ay - (acy + bvirt) + (bvirt - cy);
          bvirt = by - bcy;
          bcytail = by - (bcy + bvirt) + (bvirt - cy);
          if (acxtail === 0 && acytail === 0 && bcxtail === 0 && bcytail === 0) {
            return det;
          }
          errbound = ccwerrboundC * detsum + resulterrbound * Math.abs(det);
          det += acx * bcytail + bcy * acxtail - (acy * bcxtail + bcx * acytail);
          if (det >= errbound || -det >= errbound) return det;
          s1 = acxtail * bcy;
          c = splitter * acxtail;
          ahi = c - (c - acxtail);
          alo = acxtail - ahi;
          c = splitter * bcy;
          bhi = c - (c - bcy);
          blo = bcy - bhi;
          s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
          t1 = acytail * bcx;
          c = splitter * acytail;
          ahi = c - (c - acytail);
          alo = acytail - ahi;
          c = splitter * bcx;
          bhi = c - (c - bcx);
          blo = bcx - bhi;
          t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
          _i = s0 - t0;
          bvirt = s0 - _i;
          u[0] = s0 - (_i + bvirt) + (bvirt - t0);
          _j = s1 + _i;
          bvirt = _j - s1;
          _0 = s1 - (_j - bvirt) + (_i - bvirt);
          _i = _0 - t1;
          bvirt = _0 - _i;
          u[1] = _0 - (_i + bvirt) + (bvirt - t1);
          u3 = _j + _i;
          bvirt = u3 - _j;
          u[2] = _j - (u3 - bvirt) + (_i - bvirt);
          u[3] = u3;
          const C1len = sum(4, B, 4, u, C1);
          s1 = acx * bcytail;
          c = splitter * acx;
          ahi = c - (c - acx);
          alo = acx - ahi;
          c = splitter * bcytail;
          bhi = c - (c - bcytail);
          blo = bcytail - bhi;
          s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
          t1 = acy * bcxtail;
          c = splitter * acy;
          ahi = c - (c - acy);
          alo = acy - ahi;
          c = splitter * bcxtail;
          bhi = c - (c - bcxtail);
          blo = bcxtail - bhi;
          t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
          _i = s0 - t0;
          bvirt = s0 - _i;
          u[0] = s0 - (_i + bvirt) + (bvirt - t0);
          _j = s1 + _i;
          bvirt = _j - s1;
          _0 = s1 - (_j - bvirt) + (_i - bvirt);
          _i = _0 - t1;
          bvirt = _0 - _i;
          u[1] = _0 - (_i + bvirt) + (bvirt - t1);
          u3 = _j + _i;
          bvirt = u3 - _j;
          u[2] = _j - (u3 - bvirt) + (_i - bvirt);
          u[3] = u3;
          const C2len = sum(C1len, C1, 4, u, C2);
          s1 = acxtail * bcytail;
          c = splitter * acxtail;
          ahi = c - (c - acxtail);
          alo = acxtail - ahi;
          c = splitter * bcytail;
          bhi = c - (c - bcytail);
          blo = bcytail - bhi;
          s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
          t1 = acytail * bcxtail;
          c = splitter * acytail;
          ahi = c - (c - acytail);
          alo = acytail - ahi;
          c = splitter * bcxtail;
          bhi = c - (c - bcxtail);
          blo = bcxtail - bhi;
          t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
          _i = s0 - t0;
          bvirt = s0 - _i;
          u[0] = s0 - (_i + bvirt) + (bvirt - t0);
          _j = s1 + _i;
          bvirt = _j - s1;
          _0 = s1 - (_j - bvirt) + (_i - bvirt);
          _i = _0 - t1;
          bvirt = _0 - _i;
          u[1] = _0 - (_i + bvirt) + (bvirt - t1);
          u3 = _j + _i;
          bvirt = u3 - _j;
          u[2] = _j - (u3 - bvirt) + (_i - bvirt);
          u[3] = u3;
          const Dlen = sum(C2len, C2, 4, u, D);
          return D[Dlen - 1];
        }
        function orient2d(ax, ay, bx, by, cx, cy) {
          const detleft = (ay - cy) * (bx - cx);
          const detright = (ax - cx) * (by - cy);
          const det = detleft - detright;
          const detsum = Math.abs(detleft + detright);
          if (Math.abs(det) >= ccwerrboundA * detsum) return det;
          return -orient2dadapt(ax, ay, bx, by, cx, cy, detsum);
        }
        const crossProduct = (a, b) => a.x * b.y - a.y * b.x;
        const dotProduct = (a, b) => a.x * b.x + a.y * b.y;
        const compareVectorAngles = (basePt, endPt1, endPt2) => {
          const res = orient2d(basePt.x, basePt.y, endPt1.x, endPt1.y, endPt2.x, endPt2.y);
          if (res > 0) return -1;
          if (res < 0) return 1;
          return 0;
        };
        const length = (v) => Math.sqrt(dotProduct(v, v));
        const sineOfAngle = (pShared, pBase, pAngle) => {
          const vBase = {
            x: pBase.x - pShared.x,
            y: pBase.y - pShared.y
          };
          const vAngle = {
            x: pAngle.x - pShared.x,
            y: pAngle.y - pShared.y
          };
          return crossProduct(vAngle, vBase) / length(vAngle) / length(vBase);
        };
        const cosineOfAngle = (pShared, pBase, pAngle) => {
          const vBase = {
            x: pBase.x - pShared.x,
            y: pBase.y - pShared.y
          };
          const vAngle = {
            x: pAngle.x - pShared.x,
            y: pAngle.y - pShared.y
          };
          return dotProduct(vAngle, vBase) / length(vAngle) / length(vBase);
        };
        const horizontalIntersection = (pt, v, y) => {
          if (v.y === 0) return null;
          return {
            x: pt.x + v.x / v.y * (y - pt.y),
            y
          };
        };
        const verticalIntersection = (pt, v, x) => {
          if (v.x === 0) return null;
          return {
            x,
            y: pt.y + v.y / v.x * (x - pt.x)
          };
        };
        const intersection$1 = (pt1, v1, pt2, v2) => {
          if (v1.x === 0) return verticalIntersection(pt2, v2, pt1.x);
          if (v2.x === 0) return verticalIntersection(pt1, v1, pt2.x);
          if (v1.y === 0) return horizontalIntersection(pt2, v2, pt1.y);
          if (v2.y === 0) return horizontalIntersection(pt1, v1, pt2.y);
          const kross = crossProduct(v1, v2);
          if (kross == 0) return null;
          const ve = {
            x: pt2.x - pt1.x,
            y: pt2.y - pt1.y
          };
          const d1 = crossProduct(ve, v1) / kross;
          const d2 = crossProduct(ve, v2) / kross;
          const x1 = pt1.x + d2 * v1.x, x2 = pt2.x + d1 * v2.x;
          const y1 = pt1.y + d2 * v1.y, y2 = pt2.y + d1 * v2.y;
          const x = (x1 + x2) / 2;
          const y = (y1 + y2) / 2;
          return {
            x,
            y
          };
        };
        class SweepEvent {
          // for ordering sweep events in the sweep event queue
          static compare(a, b) {
            const ptCmp = SweepEvent.comparePoints(a.point, b.point);
            if (ptCmp !== 0) return ptCmp;
            if (a.point !== b.point) a.link(b);
            if (a.isLeft !== b.isLeft) return a.isLeft ? 1 : -1;
            return Segment.compare(a.segment, b.segment);
          }
          // for ordering points in sweep line order
          static comparePoints(aPt, bPt) {
            if (aPt.x < bPt.x) return -1;
            if (aPt.x > bPt.x) return 1;
            if (aPt.y < bPt.y) return -1;
            if (aPt.y > bPt.y) return 1;
            return 0;
          }
          // Warning: 'point' input will be modified and re-used (for performance)
          constructor(point, isLeft) {
            if (point.events === void 0) point.events = [this];
            else point.events.push(this);
            this.point = point;
            this.isLeft = isLeft;
          }
          link(other) {
            if (other.point === this.point) {
              throw new Error("Tried to link already linked events");
            }
            const otherEvents = other.point.events;
            for (let i = 0, iMax = otherEvents.length; i < iMax; i++) {
              const evt = otherEvents[i];
              this.point.events.push(evt);
              evt.point = this.point;
            }
            this.checkForConsuming();
          }
          /* Do a pass over our linked events and check to see if any pair
           * of segments match, and should be consumed. */
          checkForConsuming() {
            const numEvents = this.point.events.length;
            for (let i = 0; i < numEvents; i++) {
              const evt1 = this.point.events[i];
              if (evt1.segment.consumedBy !== void 0) continue;
              for (let j = i + 1; j < numEvents; j++) {
                const evt2 = this.point.events[j];
                if (evt2.consumedBy !== void 0) continue;
                if (evt1.otherSE.point.events !== evt2.otherSE.point.events) continue;
                evt1.segment.consume(evt2.segment);
              }
            }
          }
          getAvailableLinkedEvents() {
            const events = [];
            for (let i = 0, iMax = this.point.events.length; i < iMax; i++) {
              const evt = this.point.events[i];
              if (evt !== this && !evt.segment.ringOut && evt.segment.isInResult()) {
                events.push(evt);
              }
            }
            return events;
          }
          /**
           * Returns a comparator function for sorting linked events that will
           * favor the event that will give us the smallest left-side angle.
           * All ring construction starts as low as possible heading to the right,
           * so by always turning left as sharp as possible we'll get polygons
           * without uncessary loops & holes.
           *
           * The comparator function has a compute cache such that it avoids
           * re-computing already-computed values.
           */
          getLeftmostComparator(baseEvent) {
            const cache = /* @__PURE__ */ new Map();
            const fillCache = (linkedEvent) => {
              const nextEvent = linkedEvent.otherSE;
              cache.set(linkedEvent, {
                sine: sineOfAngle(this.point, baseEvent.point, nextEvent.point),
                cosine: cosineOfAngle(this.point, baseEvent.point, nextEvent.point)
              });
            };
            return (a, b) => {
              if (!cache.has(a)) fillCache(a);
              if (!cache.has(b)) fillCache(b);
              const {
                sine: asine,
                cosine: acosine
              } = cache.get(a);
              const {
                sine: bsine,
                cosine: bcosine
              } = cache.get(b);
              if (asine >= 0 && bsine >= 0) {
                if (acosine < bcosine) return 1;
                if (acosine > bcosine) return -1;
                return 0;
              }
              if (asine < 0 && bsine < 0) {
                if (acosine < bcosine) return -1;
                if (acosine > bcosine) return 1;
                return 0;
              }
              if (bsine < asine) return -1;
              if (bsine > asine) return 1;
              return 0;
            };
          }
        }
        let segmentId = 0;
        class Segment {
          /* This compare() function is for ordering segments in the sweep
           * line tree, and does so according to the following criteria:
           *
           * Consider the vertical line that lies an infinestimal step to the
           * right of the right-more of the two left endpoints of the input
           * segments. Imagine slowly moving a point up from negative infinity
           * in the increasing y direction. Which of the two segments will that
           * point intersect first? That segment comes 'before' the other one.
           *
           * If neither segment would be intersected by such a line, (if one
           * or more of the segments are vertical) then the line to be considered
           * is directly on the right-more of the two left inputs.
           */
          static compare(a, b) {
            const alx = a.leftSE.point.x;
            const blx = b.leftSE.point.x;
            const arx = a.rightSE.point.x;
            const brx = b.rightSE.point.x;
            if (brx < alx) return 1;
            if (arx < blx) return -1;
            const aly = a.leftSE.point.y;
            const bly = b.leftSE.point.y;
            const ary = a.rightSE.point.y;
            const bry = b.rightSE.point.y;
            if (alx < blx) {
              if (bly < aly && bly < ary) return 1;
              if (bly > aly && bly > ary) return -1;
              const aCmpBLeft = a.comparePoint(b.leftSE.point);
              if (aCmpBLeft < 0) return 1;
              if (aCmpBLeft > 0) return -1;
              const bCmpARight = b.comparePoint(a.rightSE.point);
              if (bCmpARight !== 0) return bCmpARight;
              return -1;
            }
            if (alx > blx) {
              if (aly < bly && aly < bry) return -1;
              if (aly > bly && aly > bry) return 1;
              const bCmpALeft = b.comparePoint(a.leftSE.point);
              if (bCmpALeft !== 0) return bCmpALeft;
              const aCmpBRight = a.comparePoint(b.rightSE.point);
              if (aCmpBRight < 0) return 1;
              if (aCmpBRight > 0) return -1;
              return 1;
            }
            if (aly < bly) return -1;
            if (aly > bly) return 1;
            if (arx < brx) {
              const bCmpARight = b.comparePoint(a.rightSE.point);
              if (bCmpARight !== 0) return bCmpARight;
            }
            if (arx > brx) {
              const aCmpBRight = a.comparePoint(b.rightSE.point);
              if (aCmpBRight < 0) return 1;
              if (aCmpBRight > 0) return -1;
            }
            if (arx !== brx) {
              const ay = ary - aly;
              const ax = arx - alx;
              const by = bry - bly;
              const bx = brx - blx;
              if (ay > ax && by < bx) return 1;
              if (ay < ax && by > bx) return -1;
            }
            if (arx > brx) return 1;
            if (arx < brx) return -1;
            if (ary < bry) return -1;
            if (ary > bry) return 1;
            if (a.id < b.id) return -1;
            if (a.id > b.id) return 1;
            return 0;
          }
          /* Warning: a reference to ringWindings input will be stored,
           *  and possibly will be later modified */
          constructor(leftSE, rightSE, rings, windings) {
            this.id = ++segmentId;
            this.leftSE = leftSE;
            leftSE.segment = this;
            leftSE.otherSE = rightSE;
            this.rightSE = rightSE;
            rightSE.segment = this;
            rightSE.otherSE = leftSE;
            this.rings = rings;
            this.windings = windings;
          }
          static fromRing(pt1, pt2, ring) {
            let leftPt, rightPt, winding;
            const cmpPts = SweepEvent.comparePoints(pt1, pt2);
            if (cmpPts < 0) {
              leftPt = pt1;
              rightPt = pt2;
              winding = 1;
            } else if (cmpPts > 0) {
              leftPt = pt2;
              rightPt = pt1;
              winding = -1;
            } else throw new Error(`Tried to create degenerate segment at [${pt1.x}, ${pt1.y}]`);
            const leftSE = new SweepEvent(leftPt, true);
            const rightSE = new SweepEvent(rightPt, false);
            return new Segment(leftSE, rightSE, [ring], [winding]);
          }
          /* When a segment is split, the rightSE is replaced with a new sweep event */
          replaceRightSE(newRightSE) {
            this.rightSE = newRightSE;
            this.rightSE.segment = this;
            this.rightSE.otherSE = this.leftSE;
            this.leftSE.otherSE = this.rightSE;
          }
          bbox() {
            const y1 = this.leftSE.point.y;
            const y2 = this.rightSE.point.y;
            return {
              ll: {
                x: this.leftSE.point.x,
                y: y1 < y2 ? y1 : y2
              },
              ur: {
                x: this.rightSE.point.x,
                y: y1 > y2 ? y1 : y2
              }
            };
          }
          /* A vector from the left point to the right */
          vector() {
            return {
              x: this.rightSE.point.x - this.leftSE.point.x,
              y: this.rightSE.point.y - this.leftSE.point.y
            };
          }
          isAnEndpoint(pt) {
            return pt.x === this.leftSE.point.x && pt.y === this.leftSE.point.y || pt.x === this.rightSE.point.x && pt.y === this.rightSE.point.y;
          }
          /* Compare this segment with a point.
           *
           * A point P is considered to be colinear to a segment if there
           * exists a distance D such that if we travel along the segment
           * from one * endpoint towards the other a distance D, we find
           * ourselves at point P.
           *
           * Return value indicates:
           *
           *   1: point lies above the segment (to the left of vertical)
           *   0: point is colinear to segment
           *  -1: point lies below the segment (to the right of vertical)
           */
          comparePoint(point) {
            if (this.isAnEndpoint(point)) return 0;
            const lPt = this.leftSE.point;
            const rPt = this.rightSE.point;
            const v = this.vector();
            if (lPt.x === rPt.x) {
              if (point.x === lPt.x) return 0;
              return point.x < lPt.x ? 1 : -1;
            }
            const yDist = (point.y - lPt.y) / v.y;
            const xFromYDist = lPt.x + yDist * v.x;
            if (point.x === xFromYDist) return 0;
            const xDist = (point.x - lPt.x) / v.x;
            const yFromXDist = lPt.y + xDist * v.y;
            if (point.y === yFromXDist) return 0;
            return point.y < yFromXDist ? -1 : 1;
          }
          /**
           * Given another segment, returns the first non-trivial intersection
           * between the two segments (in terms of sweep line ordering), if it exists.
           *
           * A 'non-trivial' intersection is one that will cause one or both of the
           * segments to be split(). As such, 'trivial' vs. 'non-trivial' intersection:
           *
           *   * endpoint of segA with endpoint of segB --> trivial
           *   * endpoint of segA with point along segB --> non-trivial
           *   * endpoint of segB with point along segA --> non-trivial
           *   * point along segA with point along segB --> non-trivial
           *
           * If no non-trivial intersection exists, return null
           * Else, return null.
           */
          getIntersection(other) {
            const tBbox = this.bbox();
            const oBbox = other.bbox();
            const bboxOverlap = getBboxOverlap(tBbox, oBbox);
            if (bboxOverlap === null) return null;
            const tlp = this.leftSE.point;
            const trp = this.rightSE.point;
            const olp = other.leftSE.point;
            const orp = other.rightSE.point;
            const touchesOtherLSE = isInBbox(tBbox, olp) && this.comparePoint(olp) === 0;
            const touchesThisLSE = isInBbox(oBbox, tlp) && other.comparePoint(tlp) === 0;
            const touchesOtherRSE = isInBbox(tBbox, orp) && this.comparePoint(orp) === 0;
            const touchesThisRSE = isInBbox(oBbox, trp) && other.comparePoint(trp) === 0;
            if (touchesThisLSE && touchesOtherLSE) {
              if (touchesThisRSE && !touchesOtherRSE) return trp;
              if (!touchesThisRSE && touchesOtherRSE) return orp;
              return null;
            }
            if (touchesThisLSE) {
              if (touchesOtherRSE) {
                if (tlp.x === orp.x && tlp.y === orp.y) return null;
              }
              return tlp;
            }
            if (touchesOtherLSE) {
              if (touchesThisRSE) {
                if (trp.x === olp.x && trp.y === olp.y) return null;
              }
              return olp;
            }
            if (touchesThisRSE && touchesOtherRSE) return null;
            if (touchesThisRSE) return trp;
            if (touchesOtherRSE) return orp;
            const pt = intersection$1(tlp, this.vector(), olp, other.vector());
            if (pt === null) return null;
            if (!isInBbox(bboxOverlap, pt)) return null;
            return rounder.round(pt.x, pt.y);
          }
          /**
           * Split the given segment into multiple segments on the given points.
           *  * Each existing segment will retain its leftSE and a new rightSE will be
           *    generated for it.
           *  * A new segment will be generated which will adopt the original segment's
           *    rightSE, and a new leftSE will be generated for it.
           *  * If there are more than two points given to split on, new segments
           *    in the middle will be generated with new leftSE and rightSE's.
           *  * An array of the newly generated SweepEvents will be returned.
           *
           * Warning: input array of points is modified
           */
          split(point) {
            const newEvents = [];
            const alreadyLinked = point.events !== void 0;
            const newLeftSE = new SweepEvent(point, true);
            const newRightSE = new SweepEvent(point, false);
            const oldRightSE = this.rightSE;
            this.replaceRightSE(newRightSE);
            newEvents.push(newRightSE);
            newEvents.push(newLeftSE);
            const newSeg = new Segment(newLeftSE, oldRightSE, this.rings.slice(), this.windings.slice());
            if (SweepEvent.comparePoints(newSeg.leftSE.point, newSeg.rightSE.point) > 0) {
              newSeg.swapEvents();
            }
            if (SweepEvent.comparePoints(this.leftSE.point, this.rightSE.point) > 0) {
              this.swapEvents();
            }
            if (alreadyLinked) {
              newLeftSE.checkForConsuming();
              newRightSE.checkForConsuming();
            }
            return newEvents;
          }
          /* Swap which event is left and right */
          swapEvents() {
            const tmpEvt = this.rightSE;
            this.rightSE = this.leftSE;
            this.leftSE = tmpEvt;
            this.leftSE.isLeft = true;
            this.rightSE.isLeft = false;
            for (let i = 0, iMax = this.windings.length; i < iMax; i++) {
              this.windings[i] *= -1;
            }
          }
          /* Consume another segment. We take their rings under our wing
           * and mark them as consumed. Use for perfectly overlapping segments */
          consume(other) {
            let consumer = this;
            let consumee = other;
            while (consumer.consumedBy) consumer = consumer.consumedBy;
            while (consumee.consumedBy) consumee = consumee.consumedBy;
            const cmp2 = Segment.compare(consumer, consumee);
            if (cmp2 === 0) return;
            if (cmp2 > 0) {
              const tmp = consumer;
              consumer = consumee;
              consumee = tmp;
            }
            if (consumer.prev === consumee) {
              const tmp = consumer;
              consumer = consumee;
              consumee = tmp;
            }
            for (let i = 0, iMax = consumee.rings.length; i < iMax; i++) {
              const ring = consumee.rings[i];
              const winding = consumee.windings[i];
              const index2 = consumer.rings.indexOf(ring);
              if (index2 === -1) {
                consumer.rings.push(ring);
                consumer.windings.push(winding);
              } else consumer.windings[index2] += winding;
            }
            consumee.rings = null;
            consumee.windings = null;
            consumee.consumedBy = consumer;
            consumee.leftSE.consumedBy = consumer.leftSE;
            consumee.rightSE.consumedBy = consumer.rightSE;
          }
          /* The first segment previous segment chain that is in the result */
          prevInResult() {
            if (this._prevInResult !== void 0) return this._prevInResult;
            if (!this.prev) this._prevInResult = null;
            else if (this.prev.isInResult()) this._prevInResult = this.prev;
            else this._prevInResult = this.prev.prevInResult();
            return this._prevInResult;
          }
          beforeState() {
            if (this._beforeState !== void 0) return this._beforeState;
            if (!this.prev) this._beforeState = {
              rings: [],
              windings: [],
              multiPolys: []
            };
            else {
              const seg = this.prev.consumedBy || this.prev;
              this._beforeState = seg.afterState();
            }
            return this._beforeState;
          }
          afterState() {
            if (this._afterState !== void 0) return this._afterState;
            const beforeState = this.beforeState();
            this._afterState = {
              rings: beforeState.rings.slice(0),
              windings: beforeState.windings.slice(0),
              multiPolys: []
            };
            const ringsAfter = this._afterState.rings;
            const windingsAfter = this._afterState.windings;
            const mpsAfter = this._afterState.multiPolys;
            for (let i = 0, iMax = this.rings.length; i < iMax; i++) {
              const ring = this.rings[i];
              const winding = this.windings[i];
              const index2 = ringsAfter.indexOf(ring);
              if (index2 === -1) {
                ringsAfter.push(ring);
                windingsAfter.push(winding);
              } else windingsAfter[index2] += winding;
            }
            const polysAfter = [];
            const polysExclude = [];
            for (let i = 0, iMax = ringsAfter.length; i < iMax; i++) {
              if (windingsAfter[i] === 0) continue;
              const ring = ringsAfter[i];
              const poly = ring.poly;
              if (polysExclude.indexOf(poly) !== -1) continue;
              if (ring.isExterior) polysAfter.push(poly);
              else {
                if (polysExclude.indexOf(poly) === -1) polysExclude.push(poly);
                const index2 = polysAfter.indexOf(ring.poly);
                if (index2 !== -1) polysAfter.splice(index2, 1);
              }
            }
            for (let i = 0, iMax = polysAfter.length; i < iMax; i++) {
              const mp = polysAfter[i].multiPoly;
              if (mpsAfter.indexOf(mp) === -1) mpsAfter.push(mp);
            }
            return this._afterState;
          }
          /* Is this segment part of the final result? */
          isInResult() {
            if (this.consumedBy) return false;
            if (this._isInResult !== void 0) return this._isInResult;
            const mpsBefore = this.beforeState().multiPolys;
            const mpsAfter = this.afterState().multiPolys;
            switch (operation.type) {
              case "union": {
                const noBefores = mpsBefore.length === 0;
                const noAfters = mpsAfter.length === 0;
                this._isInResult = noBefores !== noAfters;
                break;
              }
              case "intersection": {
                let least;
                let most;
                if (mpsBefore.length < mpsAfter.length) {
                  least = mpsBefore.length;
                  most = mpsAfter.length;
                } else {
                  least = mpsAfter.length;
                  most = mpsBefore.length;
                }
                this._isInResult = most === operation.numMultiPolys && least < most;
                break;
              }
              case "xor": {
                const diff = Math.abs(mpsBefore.length - mpsAfter.length);
                this._isInResult = diff % 2 === 1;
                break;
              }
              case "difference": {
                const isJustSubject = (mps) => mps.length === 1 && mps[0].isSubject;
                this._isInResult = isJustSubject(mpsBefore) !== isJustSubject(mpsAfter);
                break;
              }
              default:
                throw new Error(`Unrecognized operation type found ${operation.type}`);
            }
            return this._isInResult;
          }
        }
        class RingIn {
          constructor(geomRing, poly, isExterior) {
            if (!Array.isArray(geomRing) || geomRing.length === 0) {
              throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
            }
            this.poly = poly;
            this.isExterior = isExterior;
            this.segments = [];
            if (typeof geomRing[0][0] !== "number" || typeof geomRing[0][1] !== "number") {
              throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
            }
            const firstPoint = rounder.round(geomRing[0][0], geomRing[0][1]);
            this.bbox = {
              ll: {
                x: firstPoint.x,
                y: firstPoint.y
              },
              ur: {
                x: firstPoint.x,
                y: firstPoint.y
              }
            };
            let prevPoint = firstPoint;
            for (let i = 1, iMax = geomRing.length; i < iMax; i++) {
              if (typeof geomRing[i][0] !== "number" || typeof geomRing[i][1] !== "number") {
                throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
              }
              let point = rounder.round(geomRing[i][0], geomRing[i][1]);
              if (point.x === prevPoint.x && point.y === prevPoint.y) continue;
              this.segments.push(Segment.fromRing(prevPoint, point, this));
              if (point.x < this.bbox.ll.x) this.bbox.ll.x = point.x;
              if (point.y < this.bbox.ll.y) this.bbox.ll.y = point.y;
              if (point.x > this.bbox.ur.x) this.bbox.ur.x = point.x;
              if (point.y > this.bbox.ur.y) this.bbox.ur.y = point.y;
              prevPoint = point;
            }
            if (firstPoint.x !== prevPoint.x || firstPoint.y !== prevPoint.y) {
              this.segments.push(Segment.fromRing(prevPoint, firstPoint, this));
            }
          }
          getSweepEvents() {
            const sweepEvents = [];
            for (let i = 0, iMax = this.segments.length; i < iMax; i++) {
              const segment2 = this.segments[i];
              sweepEvents.push(segment2.leftSE);
              sweepEvents.push(segment2.rightSE);
            }
            return sweepEvents;
          }
        }
        class PolyIn {
          constructor(geomPoly, multiPoly) {
            if (!Array.isArray(geomPoly)) {
              throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
            }
            this.exteriorRing = new RingIn(geomPoly[0], this, true);
            this.bbox = {
              ll: {
                x: this.exteriorRing.bbox.ll.x,
                y: this.exteriorRing.bbox.ll.y
              },
              ur: {
                x: this.exteriorRing.bbox.ur.x,
                y: this.exteriorRing.bbox.ur.y
              }
            };
            this.interiorRings = [];
            for (let i = 1, iMax = geomPoly.length; i < iMax; i++) {
              const ring = new RingIn(geomPoly[i], this, false);
              if (ring.bbox.ll.x < this.bbox.ll.x) this.bbox.ll.x = ring.bbox.ll.x;
              if (ring.bbox.ll.y < this.bbox.ll.y) this.bbox.ll.y = ring.bbox.ll.y;
              if (ring.bbox.ur.x > this.bbox.ur.x) this.bbox.ur.x = ring.bbox.ur.x;
              if (ring.bbox.ur.y > this.bbox.ur.y) this.bbox.ur.y = ring.bbox.ur.y;
              this.interiorRings.push(ring);
            }
            this.multiPoly = multiPoly;
          }
          getSweepEvents() {
            const sweepEvents = this.exteriorRing.getSweepEvents();
            for (let i = 0, iMax = this.interiorRings.length; i < iMax; i++) {
              const ringSweepEvents = this.interiorRings[i].getSweepEvents();
              for (let j = 0, jMax = ringSweepEvents.length; j < jMax; j++) {
                sweepEvents.push(ringSweepEvents[j]);
              }
            }
            return sweepEvents;
          }
        }
        class MultiPolyIn {
          constructor(geom, isSubject) {
            if (!Array.isArray(geom)) {
              throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
            }
            try {
              if (typeof geom[0][0][0] === "number") geom = [geom];
            } catch (ex) {
            }
            this.polys = [];
            this.bbox = {
              ll: {
                x: Number.POSITIVE_INFINITY,
                y: Number.POSITIVE_INFINITY
              },
              ur: {
                x: Number.NEGATIVE_INFINITY,
                y: Number.NEGATIVE_INFINITY
              }
            };
            for (let i = 0, iMax = geom.length; i < iMax; i++) {
              const poly = new PolyIn(geom[i], this);
              if (poly.bbox.ll.x < this.bbox.ll.x) this.bbox.ll.x = poly.bbox.ll.x;
              if (poly.bbox.ll.y < this.bbox.ll.y) this.bbox.ll.y = poly.bbox.ll.y;
              if (poly.bbox.ur.x > this.bbox.ur.x) this.bbox.ur.x = poly.bbox.ur.x;
              if (poly.bbox.ur.y > this.bbox.ur.y) this.bbox.ur.y = poly.bbox.ur.y;
              this.polys.push(poly);
            }
            this.isSubject = isSubject;
          }
          getSweepEvents() {
            const sweepEvents = [];
            for (let i = 0, iMax = this.polys.length; i < iMax; i++) {
              const polySweepEvents = this.polys[i].getSweepEvents();
              for (let j = 0, jMax = polySweepEvents.length; j < jMax; j++) {
                sweepEvents.push(polySweepEvents[j]);
              }
            }
            return sweepEvents;
          }
        }
        class RingOut {
          /* Given the segments from the sweep line pass, compute & return a series
           * of closed rings from all the segments marked to be part of the result */
          static factory(allSegments) {
            const ringsOut = [];
            for (let i = 0, iMax = allSegments.length; i < iMax; i++) {
              const segment2 = allSegments[i];
              if (!segment2.isInResult() || segment2.ringOut) continue;
              let prevEvent = null;
              let event = segment2.leftSE;
              let nextEvent = segment2.rightSE;
              const events = [event];
              const startingPoint = event.point;
              const intersectionLEs = [];
              while (true) {
                prevEvent = event;
                event = nextEvent;
                events.push(event);
                if (event.point === startingPoint) break;
                while (true) {
                  const availableLEs = event.getAvailableLinkedEvents();
                  if (availableLEs.length === 0) {
                    const firstPt = events[0].point;
                    const lastPt = events[events.length - 1].point;
                    throw new Error(`Unable to complete output ring starting at [${firstPt.x}, ${firstPt.y}]. Last matching segment found ends at [${lastPt.x}, ${lastPt.y}].`);
                  }
                  if (availableLEs.length === 1) {
                    nextEvent = availableLEs[0].otherSE;
                    break;
                  }
                  let indexLE = null;
                  for (let j = 0, jMax = intersectionLEs.length; j < jMax; j++) {
                    if (intersectionLEs[j].point === event.point) {
                      indexLE = j;
                      break;
                    }
                  }
                  if (indexLE !== null) {
                    const intersectionLE = intersectionLEs.splice(indexLE)[0];
                    const ringEvents = events.splice(intersectionLE.index);
                    ringEvents.unshift(ringEvents[0].otherSE);
                    ringsOut.push(new RingOut(ringEvents.reverse()));
                    continue;
                  }
                  intersectionLEs.push({
                    index: events.length,
                    point: event.point
                  });
                  const comparator = event.getLeftmostComparator(prevEvent);
                  nextEvent = availableLEs.sort(comparator)[0].otherSE;
                  break;
                }
              }
              ringsOut.push(new RingOut(events));
            }
            return ringsOut;
          }
          constructor(events) {
            this.events = events;
            for (let i = 0, iMax = events.length; i < iMax; i++) {
              events[i].segment.ringOut = this;
            }
            this.poly = null;
          }
          getGeom() {
            let prevPt = this.events[0].point;
            const points = [prevPt];
            for (let i = 1, iMax = this.events.length - 1; i < iMax; i++) {
              const pt2 = this.events[i].point;
              const nextPt2 = this.events[i + 1].point;
              if (compareVectorAngles(pt2, prevPt, nextPt2) === 0) continue;
              points.push(pt2);
              prevPt = pt2;
            }
            if (points.length === 1) return null;
            const pt = points[0];
            const nextPt = points[1];
            if (compareVectorAngles(pt, prevPt, nextPt) === 0) points.shift();
            points.push(points[0]);
            const step = this.isExteriorRing() ? 1 : -1;
            const iStart = this.isExteriorRing() ? 0 : points.length - 1;
            const iEnd = this.isExteriorRing() ? points.length : -1;
            const orderedPoints = [];
            for (let i = iStart; i != iEnd; i += step) orderedPoints.push([points[i].x, points[i].y]);
            return orderedPoints;
          }
          isExteriorRing() {
            if (this._isExteriorRing === void 0) {
              const enclosing = this.enclosingRing();
              this._isExteriorRing = enclosing ? !enclosing.isExteriorRing() : true;
            }
            return this._isExteriorRing;
          }
          enclosingRing() {
            if (this._enclosingRing === void 0) {
              this._enclosingRing = this._calcEnclosingRing();
            }
            return this._enclosingRing;
          }
          /* Returns the ring that encloses this one, if any */
          _calcEnclosingRing() {
            let leftMostEvt = this.events[0];
            for (let i = 1, iMax = this.events.length; i < iMax; i++) {
              const evt = this.events[i];
              if (SweepEvent.compare(leftMostEvt, evt) > 0) leftMostEvt = evt;
            }
            let prevSeg = leftMostEvt.segment.prevInResult();
            let prevPrevSeg = prevSeg ? prevSeg.prevInResult() : null;
            while (true) {
              if (!prevSeg) return null;
              if (!prevPrevSeg) return prevSeg.ringOut;
              if (prevPrevSeg.ringOut !== prevSeg.ringOut) {
                if (prevPrevSeg.ringOut.enclosingRing() !== prevSeg.ringOut) {
                  return prevSeg.ringOut;
                } else return prevSeg.ringOut.enclosingRing();
              }
              prevSeg = prevPrevSeg.prevInResult();
              prevPrevSeg = prevSeg ? prevSeg.prevInResult() : null;
            }
          }
        }
        class PolyOut {
          constructor(exteriorRing) {
            this.exteriorRing = exteriorRing;
            exteriorRing.poly = this;
            this.interiorRings = [];
          }
          addInterior(ring) {
            this.interiorRings.push(ring);
            ring.poly = this;
          }
          getGeom() {
            const geom = [this.exteriorRing.getGeom()];
            if (geom[0] === null) return null;
            for (let i = 0, iMax = this.interiorRings.length; i < iMax; i++) {
              const ringGeom = this.interiorRings[i].getGeom();
              if (ringGeom === null) continue;
              geom.push(ringGeom);
            }
            return geom;
          }
        }
        class MultiPolyOut {
          constructor(rings) {
            this.rings = rings;
            this.polys = this._composePolys(rings);
          }
          getGeom() {
            const geom = [];
            for (let i = 0, iMax = this.polys.length; i < iMax; i++) {
              const polyGeom = this.polys[i].getGeom();
              if (polyGeom === null) continue;
              geom.push(polyGeom);
            }
            return geom;
          }
          _composePolys(rings) {
            const polys = [];
            for (let i = 0, iMax = rings.length; i < iMax; i++) {
              const ring = rings[i];
              if (ring.poly) continue;
              if (ring.isExteriorRing()) polys.push(new PolyOut(ring));
              else {
                const enclosingRing = ring.enclosingRing();
                if (!enclosingRing.poly) polys.push(new PolyOut(enclosingRing));
                enclosingRing.poly.addInterior(ring);
              }
            }
            return polys;
          }
        }
        class SweepLine {
          constructor(queue) {
            let comparator = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : Segment.compare;
            this.queue = queue;
            this.tree = new Tree(comparator);
            this.segments = [];
          }
          process(event) {
            const segment2 = event.segment;
            const newEvents = [];
            if (event.consumedBy) {
              if (event.isLeft) this.queue.remove(event.otherSE);
              else this.tree.remove(segment2);
              return newEvents;
            }
            const node = event.isLeft ? this.tree.add(segment2) : this.tree.find(segment2);
            if (!node) throw new Error(`Unable to find segment #${segment2.id} [${segment2.leftSE.point.x}, ${segment2.leftSE.point.y}] -> [${segment2.rightSE.point.x}, ${segment2.rightSE.point.y}] in SweepLine tree.`);
            let prevNode = node;
            let nextNode = node;
            let prevSeg = void 0;
            let nextSeg = void 0;
            while (prevSeg === void 0) {
              prevNode = this.tree.prev(prevNode);
              if (prevNode === null) prevSeg = null;
              else if (prevNode.key.consumedBy === void 0) prevSeg = prevNode.key;
            }
            while (nextSeg === void 0) {
              nextNode = this.tree.next(nextNode);
              if (nextNode === null) nextSeg = null;
              else if (nextNode.key.consumedBy === void 0) nextSeg = nextNode.key;
            }
            if (event.isLeft) {
              let prevMySplitter = null;
              if (prevSeg) {
                const prevInter = prevSeg.getIntersection(segment2);
                if (prevInter !== null) {
                  if (!segment2.isAnEndpoint(prevInter)) prevMySplitter = prevInter;
                  if (!prevSeg.isAnEndpoint(prevInter)) {
                    const newEventsFromSplit = this._splitSafely(prevSeg, prevInter);
                    for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
                      newEvents.push(newEventsFromSplit[i]);
                    }
                  }
                }
              }
              let nextMySplitter = null;
              if (nextSeg) {
                const nextInter = nextSeg.getIntersection(segment2);
                if (nextInter !== null) {
                  if (!segment2.isAnEndpoint(nextInter)) nextMySplitter = nextInter;
                  if (!nextSeg.isAnEndpoint(nextInter)) {
                    const newEventsFromSplit = this._splitSafely(nextSeg, nextInter);
                    for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
                      newEvents.push(newEventsFromSplit[i]);
                    }
                  }
                }
              }
              if (prevMySplitter !== null || nextMySplitter !== null) {
                let mySplitter = null;
                if (prevMySplitter === null) mySplitter = nextMySplitter;
                else if (nextMySplitter === null) mySplitter = prevMySplitter;
                else {
                  const cmpSplitters = SweepEvent.comparePoints(prevMySplitter, nextMySplitter);
                  mySplitter = cmpSplitters <= 0 ? prevMySplitter : nextMySplitter;
                }
                this.queue.remove(segment2.rightSE);
                newEvents.push(segment2.rightSE);
                const newEventsFromSplit = segment2.split(mySplitter);
                for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
                  newEvents.push(newEventsFromSplit[i]);
                }
              }
              if (newEvents.length > 0) {
                this.tree.remove(segment2);
                newEvents.push(event);
              } else {
                this.segments.push(segment2);
                segment2.prev = prevSeg;
              }
            } else {
              if (prevSeg && nextSeg) {
                const inter = prevSeg.getIntersection(nextSeg);
                if (inter !== null) {
                  if (!prevSeg.isAnEndpoint(inter)) {
                    const newEventsFromSplit = this._splitSafely(prevSeg, inter);
                    for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
                      newEvents.push(newEventsFromSplit[i]);
                    }
                  }
                  if (!nextSeg.isAnEndpoint(inter)) {
                    const newEventsFromSplit = this._splitSafely(nextSeg, inter);
                    for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
                      newEvents.push(newEventsFromSplit[i]);
                    }
                  }
                }
              }
              this.tree.remove(segment2);
            }
            return newEvents;
          }
          /* Safely split a segment that is currently in the datastructures
           * IE - a segment other than the one that is currently being processed. */
          _splitSafely(seg, pt) {
            this.tree.remove(seg);
            const rightSE = seg.rightSE;
            this.queue.remove(rightSE);
            const newEvents = seg.split(pt);
            newEvents.push(rightSE);
            if (seg.consumedBy === void 0) this.tree.add(seg);
            return newEvents;
          }
        }
        const POLYGON_CLIPPING_MAX_QUEUE_SIZE = typeof process !== "undefined" && process.env.POLYGON_CLIPPING_MAX_QUEUE_SIZE || 1e6;
        const POLYGON_CLIPPING_MAX_SWEEPLINE_SEGMENTS = typeof process !== "undefined" && process.env.POLYGON_CLIPPING_MAX_SWEEPLINE_SEGMENTS || 1e6;
        class Operation {
          run(type, geom, moreGeoms) {
            operation.type = type;
            rounder.reset();
            const multipolys = [new MultiPolyIn(geom, true)];
            for (let i = 0, iMax = moreGeoms.length; i < iMax; i++) {
              multipolys.push(new MultiPolyIn(moreGeoms[i], false));
            }
            operation.numMultiPolys = multipolys.length;
            if (operation.type === "difference") {
              const subject = multipolys[0];
              let i = 1;
              while (i < multipolys.length) {
                if (getBboxOverlap(multipolys[i].bbox, subject.bbox) !== null) i++;
                else multipolys.splice(i, 1);
              }
            }
            if (operation.type === "intersection") {
              for (let i = 0, iMax = multipolys.length; i < iMax; i++) {
                const mpA = multipolys[i];
                for (let j = i + 1, jMax = multipolys.length; j < jMax; j++) {
                  if (getBboxOverlap(mpA.bbox, multipolys[j].bbox) === null) return [];
                }
              }
            }
            const queue = new Tree(SweepEvent.compare);
            for (let i = 0, iMax = multipolys.length; i < iMax; i++) {
              const sweepEvents = multipolys[i].getSweepEvents();
              for (let j = 0, jMax = sweepEvents.length; j < jMax; j++) {
                queue.insert(sweepEvents[j]);
                if (queue.size > POLYGON_CLIPPING_MAX_QUEUE_SIZE) {
                  throw new Error("Infinite loop when putting segment endpoints in a priority queue (queue size too big).");
                }
              }
            }
            const sweepLine = new SweepLine(queue);
            let prevQueueSize = queue.size;
            let node = queue.pop();
            while (node) {
              const evt = node.key;
              if (queue.size === prevQueueSize) {
                const seg = evt.segment;
                throw new Error(`Unable to pop() ${evt.isLeft ? "left" : "right"} SweepEvent [${evt.point.x}, ${evt.point.y}] from segment #${seg.id} [${seg.leftSE.point.x}, ${seg.leftSE.point.y}] -> [${seg.rightSE.point.x}, ${seg.rightSE.point.y}] from queue.`);
              }
              if (queue.size > POLYGON_CLIPPING_MAX_QUEUE_SIZE) {
                throw new Error("Infinite loop when passing sweep line over endpoints (queue size too big).");
              }
              if (sweepLine.segments.length > POLYGON_CLIPPING_MAX_SWEEPLINE_SEGMENTS) {
                throw new Error("Infinite loop when passing sweep line over endpoints (too many sweep line segments).");
              }
              const newEvents = sweepLine.process(evt);
              for (let i = 0, iMax = newEvents.length; i < iMax; i++) {
                const evt2 = newEvents[i];
                if (evt2.consumedBy === void 0) queue.insert(evt2);
              }
              prevQueueSize = queue.size;
              node = queue.pop();
            }
            rounder.reset();
            const ringsOut = RingOut.factory(sweepLine.segments);
            const result = new MultiPolyOut(ringsOut);
            return result.getGeom();
          }
        }
        const operation = new Operation();
        const union = function(geom) {
          for (var _len = arguments.length, moreGeoms = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
            moreGeoms[_key - 1] = arguments[_key];
          }
          return operation.run("union", geom, moreGeoms);
        };
        const intersection = function(geom) {
          for (var _len2 = arguments.length, moreGeoms = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
            moreGeoms[_key2 - 1] = arguments[_key2];
          }
          return operation.run("intersection", geom, moreGeoms);
        };
        const xor = function(geom) {
          for (var _len3 = arguments.length, moreGeoms = new Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) {
            moreGeoms[_key3 - 1] = arguments[_key3];
          }
          return operation.run("xor", geom, moreGeoms);
        };
        const difference = function(subjectGeom) {
          for (var _len4 = arguments.length, clippingGeoms = new Array(_len4 > 1 ? _len4 - 1 : 0), _key4 = 1; _key4 < _len4; _key4++) {
            clippingGeoms[_key4 - 1] = arguments[_key4];
          }
          return operation.run("difference", subjectGeom, clippingGeoms);
        };
        var index = {
          union,
          intersection,
          xor,
          difference
        };
        return index;
      }));
    }
  });

  // ../engine/src/project.ts
  var ANIMATABLE_PROPERTIES = [
    "x",
    "y",
    "scaleX",
    "scaleY",
    "rotation",
    "opacity"
  ];
  var GEOMETRY_PROPERTIES = [
    "width",
    "height",
    "cornerRadius",
    "radiusX",
    "radiusY"
  ];
  var PRIMITIVE_PROPERTIES = [
    "sides",
    "starPoints",
    "innerRatio",
    "primitiveRotation"
  ];
  var _all = [
    ...ANIMATABLE_PROPERTIES,
    ...GEOMETRY_PROPERTIES,
    ...PRIMITIVE_PROPERTIES,
    "textPathOffset"
  ];

  // ../engine/src/easing.ts
  var easingRegistry = {
    linear: (t) => t,
    easeIn: (t) => t * t,
    easeOut: (t) => t * (2 - t),
    easeInOut: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
  };
  function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
    const sampleY = (t) => ((ay * t + by) * t + cy) * t;
    const sampleDX = (t) => (3 * ax * t + 2 * bx) * t + cx;
    const solveX = (x) => {
      let t = x;
      for (let i = 0; i < 8; i++) {
        const xError = sampleX(t) - x;
        if (Math.abs(xError) < 1e-6) return t;
        const dx = sampleDX(t);
        if (Math.abs(dx) < 1e-6) break;
        t -= xError / dx;
        t = Math.min(1, Math.max(0, t));
      }
      let lo = 0;
      let hi = 1;
      t = x;
      for (let i = 0; i < 30; i++) {
        const xValue = sampleX(t);
        if (Math.abs(xValue - x) < 1e-6) return t;
        if (x > xValue) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
      return t;
    };
    return (t) => {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      return sampleY(solveX(t));
    };
  }
  function applyEasing(easing, t) {
    if (typeof easing === "string") {
      return easingRegistry[easing](t);
    }
    return cubicBezier(easing.p1, easing.p2, easing.p3, easing.p4)(t);
  }

  // ../engine/src/color.ts
  function parseHex(c) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
    if (!m) return null;
    let hex = m[1];
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16)
    };
  }
  function formatHex({ r, g, b }) {
    const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
  }
  function interpolateColor(a, b, t) {
    const ca = parseHex(a);
    const cb = parseHex(b);
    if (!ca || !cb) return t >= 1 ? b : a;
    return formatHex({
      r: ca.r + (cb.r - ca.r) * t,
      g: ca.g + (cb.g - ca.g) * t,
      b: ca.b + (cb.b - ca.b) * t
    });
  }
  function sampleColor(track, time) {
    if (track.length === 0) {
      throw new Error("sampleColor: track must contain at least one keyframe");
    }
    const first = track[0];
    const last = track[track.length - 1];
    if (time <= first.time) return first.value;
    if (time >= last.time) return last.value;
    let a = first;
    let b = last;
    for (let i = 0; i < track.length - 1; i++) {
      if (time >= track[i].time && time < track[i + 1].time) {
        a = track[i];
        b = track[i + 1];
        break;
      }
    }
    const span = b.time - a.time;
    const rawProgress = span === 0 ? 0 : (time - a.time) / span;
    return interpolateColor(a.value, b.value, applyEasing(a.easing, rawProgress));
  }

  // ../engine/src/interpolate.ts
  function shortestAngleTarget(from, to) {
    const delta = ((to - from) % 360 + 540) % 360 - 180;
    return from + delta;
  }
  function interpolate(track, time, isRotation = false) {
    if (track.length === 0) {
      throw new Error("interpolate: track must contain at least one keyframe");
    }
    const first = track[0];
    const last = track[track.length - 1];
    if (time <= first.time) return first.value;
    if (time >= last.time) return last.value;
    let a = first;
    let b = last;
    for (let i = 0; i < track.length - 1; i++) {
      if (time >= track[i].time && time < track[i + 1].time) {
        a = track[i];
        b = track[i + 1];
        break;
      }
    }
    const span = b.time - a.time;
    const rawProgress = span === 0 ? 0 : (time - a.time) / span;
    const progress = applyEasing(a.easing, rawProgress);
    const useShortest = isRotation && a.rotationMode !== "raw";
    const target = useShortest ? shortestAngleTarget(a.value, b.value) : b.value;
    return a.value + (target - a.value) * progress;
  }

  // ../engine/src/transform.ts
  function fmt(n) {
    if (!Number.isFinite(n)) return "0";
    const rounded = Math.round(n * 1e4) / 1e4;
    const normalized = Object.is(rounded, -0) ? 0 : rounded;
    return String(normalized);
  }
  function buildTransform(t, anchorX, anchorY) {
    return [
      `translate(${fmt(t.x)}, ${fmt(t.y)})`,
      `rotate(${fmt(t.rotation)}, ${fmt(anchorX)}, ${fmt(anchorY)})`,
      `translate(${fmt(anchorX)}, ${fmt(anchorY)})`,
      `scale(${fmt(t.scaleX)}, ${fmt(t.scaleY)})`,
      `translate(${fmt(-anchorX)}, ${fmt(-anchorY)})`
    ].join(" ");
  }

  // ../engine/src/geom/arcLength.ts
  var FLATTEN_STEPS = 16;
  function add(anchor, offset) {
    return offset ? { x: anchor.x + offset.x, y: anchor.y + offset.y } : anchor;
  }
  function dist(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  function lerpPoint(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  function cubicAt(p0, c1, c2, p3, u) {
    const v = 1 - u;
    const a = v * v * v;
    const b = 3 * v * v * u;
    const c = 3 * v * u * u;
    const d = u * u * u;
    return {
      x: a * p0.x + b * c1.x + c * c2.x + d * p3.x,
      y: a * p0.y + b * c1.y + c * c2.y + d * p3.y
    };
  }
  function flattenPoints(path) {
    const { nodes, closed } = path;
    if (nodes.length === 0) return [];
    const pts = [{ x: nodes[0].anchor.x, y: nodes[0].anchor.y }];
    const pushSegment = (prev, cur) => {
      if (prev.out || cur.in) {
        const c1 = add(prev.anchor, prev.out);
        const c2 = add(cur.anchor, cur.in);
        for (let s = 1; s <= FLATTEN_STEPS; s++) {
          pts.push(cubicAt(prev.anchor, c1, c2, cur.anchor, s / FLATTEN_STEPS));
        }
      } else {
        pts.push({ x: cur.anchor.x, y: cur.anchor.y });
      }
    };
    for (let i = 1; i < nodes.length; i++) pushSegment(nodes[i - 1], nodes[i]);
    if (closed && nodes.length > 1) pushSegment(nodes[nodes.length - 1], nodes[0]);
    return pts;
  }
  function flattenPath(path) {
    const pts = flattenPoints(path);
    if (pts.length === 0) return { pts, cum: [], total: 0 };
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    return { pts, cum, total: cum[cum.length - 1] };
  }
  function pointAtLength(flat, target) {
    const { pts, cum, total } = flat;
    if (pts.length === 0) return { x: 0, y: 0 };
    if (target <= 0) return { x: pts[0].x, y: pts[0].y };
    if (target >= total) return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
    let j = 1;
    while (j < cum.length && cum[j] < target) j++;
    const segLen = cum[j] - cum[j - 1];
    const t = segLen === 0 ? 0 : (target - cum[j - 1]) / segLen;
    return lerpPoint(pts[j - 1], pts[j], t);
  }

  // ../engine/src/morph/resample.ts
  var SAMPLE_COUNT = 64;
  function resample(path, n = SAMPLE_COUNT) {
    const flat = flattenPath(path);
    if (flat.pts.length === 0) {
      return Array.from({ length: n }, () => ({ anchor: { x: 0, y: 0 } }));
    }
    const total = flat.total;
    if (total === 0) {
      const p = flat.pts[0];
      return Array.from({ length: n }, () => ({ anchor: { x: p.x, y: p.y } }));
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const frac = n <= 1 ? 0 : path.closed ? i / n : i / (n - 1);
      out.push({ anchor: pointAtLength(flat, frac * total) });
    }
    return out;
  }

  // ../engine/src/morph/align.ts
  function sqDist(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return dx * dx + dy * dy;
  }
  function cost(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += sqDist(a[i].anchor, b[i].anchor);
    return s;
  }
  function rotate(nodes, k) {
    if (k === 0) return nodes;
    return nodes.slice(k).concat(nodes.slice(0, k));
  }
  function bestAlignment(b, a, closed) {
    const n = b.length;
    if (n === 0) return { offset: 0, reversed: false };
    let best = { offset: 0, reversed: false };
    let bestCost = cost(a, b);
    const consider = (cand, offset, reversed2) => {
      const c = cost(a, cand);
      if (c < bestCost) {
        bestCost = c;
        best = { offset, reversed: reversed2 };
      }
    };
    const reversed = b.slice().reverse();
    if (closed) {
      for (let k = 1; k < n; k++) consider(rotate(b, k), k, false);
      for (let k = 0; k < n; k++) consider(rotate(reversed, k), k, true);
    } else {
      consider(reversed, 0, true);
    }
    return best;
  }
  function align(b, a, closed) {
    const { offset, reversed } = bestAlignment(b, a, closed);
    const base = reversed ? b.slice().reverse() : b;
    return rotate(base, offset);
  }

  // ../engine/src/morph/reconcile.ts
  function padNodes(nodes, len) {
    if (nodes.length >= len) return nodes;
    const last = nodes[nodes.length - 1];
    const padded = nodes.slice();
    while (padded.length < len) padded.push({ anchor: { x: last.anchor.x, y: last.anchor.y } });
    return padded;
  }
  function validMap(c, m, n) {
    if (!c || c.length !== m || n === 0) return false;
    for (const j of c) {
      if (!Number.isInteger(j) || j < 0 || j >= n) return false;
    }
    return true;
  }
  function reconcileMap(a, b, c) {
    const an = [];
    const bn = [];
    const aIndex = [];
    let lastAAnchor = a.nodes[0].anchor;
    for (let j = 0; j < b.nodes.length; j++) {
      const srcs = [];
      for (let i = 0; i < c.length; i++) if (c[i] === j) srcs.push(i);
      if (srcs.length === 0) {
        an.push({ anchor: { x: lastAAnchor.x, y: lastAAnchor.y } });
        bn.push(b.nodes[j]);
        aIndex.push(-1);
      } else {
        for (const i of srcs) {
          an.push(a.nodes[i]);
          bn.push(b.nodes[j]);
          aIndex.push(i);
          lastAAnchor = a.nodes[i].anchor;
        }
      }
    }
    return { an, bn, aIndex };
  }
  function reconcile(a, b, mode, correspondence) {
    if (mode === "resampled") {
      const an = resample(a, SAMPLE_COUNT);
      const bn = align(resample(b, SAMPLE_COUNT), an, a.closed);
      return { an, bn, aIndex: new Array(an.length).fill(-1) };
    }
    if (validMap(correspondence, a.nodes.length, b.nodes.length)) {
      return reconcileMap(a, b, correspondence);
    }
    const len = Math.max(a.nodes.length, b.nodes.length);
    const m = a.nodes.length;
    const aIndex = Array.from({ length: len }, (_, i) => i < m ? i : -1);
    return { an: padNodes(a.nodes, len), bn: padNodes(b.nodes, len), aIndex };
  }

  // ../engine/src/path.ts
  function add2(anchor, offset) {
    return offset ? { x: anchor.x + offset.x, y: anchor.y + offset.y } : anchor;
  }
  function segment(prev, cur) {
    if (prev.out || cur.in) {
      const c1 = add2(prev.anchor, prev.out);
      const c2 = add2(cur.anchor, cur.in);
      return `C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(cur.anchor.x)} ${fmt(cur.anchor.y)}`;
    }
    return `L ${fmt(cur.anchor.x)} ${fmt(cur.anchor.y)}`;
  }
  function pathToD(path) {
    const { nodes, closed } = path;
    if (nodes.length === 0) return "";
    const parts = [`M ${fmt(nodes[0].anchor.x)} ${fmt(nodes[0].anchor.y)}`];
    for (let i = 1; i < nodes.length; i++) {
      parts.push(segment(nodes[i - 1], nodes[i]));
    }
    if (closed && nodes.length > 1) {
      const last = nodes[nodes.length - 1];
      if (last.out || nodes[0].in) {
        parts.push(segment(last, nodes[0]));
      }
      parts.push("Z");
    }
    return parts.join(" ");
  }
  function pathToDRings(primary, rings) {
    const base = pathToD(primary);
    if (!rings || rings.length === 0) return base;
    return [base, ...rings.map(pathToD)].filter((d) => d.length > 0).join(" ");
  }
  var BOUNDS_EPS = 1e-9;
  function quadRootsInUnit(a, b, c) {
    const out = [];
    if (Math.abs(a) < BOUNDS_EPS) {
      if (Math.abs(b) >= BOUNDS_EPS) out.push(-c / b);
    } else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const s = Math.sqrt(disc);
        out.push((-b + s) / (2 * a), (-b - s) / (2 * a));
      }
    }
    return out.filter((t) => t > BOUNDS_EPS && t < 1 - BOUNDS_EPS);
  }
  function cubicExtremaParams(p0, c1, c2, p3) {
    const d0 = c1 - p0;
    const d1 = c2 - c1;
    const d2 = p3 - c2;
    return quadRootsInUnit(d0 - 2 * d1 + d2, 2 * (d1 - d0), d0);
  }
  function cubicAt2(p0, c1, c2, p3, t) {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p3;
  }
  function pathBounds(path) {
    const { nodes, closed } = path;
    if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const fold = (x, y) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };
    for (const n of nodes) fold(n.anchor.x, n.anchor.y);
    const curve = (prev, cur) => {
      if (!prev.out && !cur.in) return;
      const c1 = add2(prev.anchor, prev.out);
      const c2 = add2(cur.anchor, cur.in);
      const ax = [prev.anchor.x, c1.x, c2.x, cur.anchor.x];
      const ay = [prev.anchor.y, c1.y, c2.y, cur.anchor.y];
      const ts = [...cubicExtremaParams(...ax), ...cubicExtremaParams(...ay)];
      for (const t of ts) fold(cubicAt2(...ax, t), cubicAt2(...ay, t));
    };
    for (let i = 1; i < nodes.length; i++) curve(nodes[i - 1], nodes[i]);
    if (closed && nodes.length > 1) curve(nodes[nodes.length - 1], nodes[0]);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  var ZERO = { x: 0, y: 0 };
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function lerpPoint2(a, b, t) {
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  }
  function lerpNode(a, b, t) {
    const node = { anchor: lerpPoint2(a.anchor, b.anchor, t) };
    if (a.in || b.in) node.in = lerpPoint2(a.in ?? ZERO, b.in ?? ZERO, t);
    if (a.out || b.out) node.out = lerpPoint2(a.out ?? ZERO, b.out ?? ZERO, t);
    return node;
  }
  function samplePath(track, time) {
    if (track.length === 0) {
      throw new Error("samplePath: track must contain at least one keyframe");
    }
    const first = track[0];
    const last = track[track.length - 1];
    if (time <= first.time) return first.path;
    if (time >= last.time) return last.path;
    let a = first;
    let b = last;
    for (let i = 0; i < track.length - 1; i++) {
      if (time >= track[i].time && time < track[i + 1].time) {
        a = track[i];
        b = track[i + 1];
        break;
      }
    }
    const span = b.time - a.time;
    const rawProgress = span === 0 ? 0 : (time - a.time) / span;
    const { an, bn, aIndex } = reconcile(a.path, b.path, a.morph ?? "corresponded", a.correspondence);
    const nodes = [];
    for (let k = 0; k < an.length; k++) {
      const e = (aIndex[k] >= 0 ? a.nodeEasings?.[aIndex[k]] : void 0) ?? a.easing;
      nodes.push(lerpNode(an[k], bn[k], applyEasing(e, rawProgress)));
    }
    return { nodes, closed: a.path.closed };
  }

  // ../engine/src/gradientAnim.ts
  var lerp2 = (a, b, t) => a + (b - a) * t;
  var STOP_EPS = 1e-6;
  function stopAt(stops, offset) {
    const sorted = [...stops].sort((p, q) => p.offset - q.offset);
    if (offset <= sorted[0].offset) return { ...sorted[0], offset };
    const last = sorted[sorted.length - 1];
    if (offset >= last.offset) return { ...last, offset };
    let lo = sorted[0];
    let hi = last;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (offset >= sorted[i].offset && offset <= sorted[i + 1].offset) {
        lo = sorted[i];
        hi = sorted[i + 1];
        break;
      }
    }
    const span = hi.offset - lo.offset;
    const local = span < STOP_EPS ? 0 : (offset - lo.offset) / span;
    const stop = { offset, color: interpolateColor(lo.color, hi.color, local) };
    const olo = lo.opacity ?? 1;
    const ohi = hi.opacity ?? 1;
    if (olo !== 1 || ohi !== 1) {
      const o = lerp2(olo, ohi, local);
      if (o < 1) stop.opacity = o;
    }
    return stop;
  }
  function reconcileStops(a, b) {
    const offsets = [];
    for (const o of [...a, ...b].map((s) => s.offset).sort((p, q) => p - q)) {
      if (offsets.length === 0 || o - offsets[offsets.length - 1] > STOP_EPS) offsets.push(o);
    }
    return { an: offsets.map((o) => stopAt(a, o)), bn: offsets.map((o) => stopAt(b, o)) };
  }
  function lerpStops(a, b, t) {
    return a.map((sa, i) => {
      const sb = b[i];
      const stop = {
        offset: lerp2(sa.offset, sb.offset, t),
        color: interpolateColor(sa.color, sb.color, t)
      };
      const oa = sa.opacity ?? 1;
      const ob = sb.opacity ?? 1;
      if (oa !== 1 || ob !== 1) {
        const o = lerp2(oa, ob, t);
        if (o < 1) stop.opacity = o;
      }
      return stop;
    });
  }
  function interpolateGradient(a, b, t) {
    if (a.type !== b.type) {
      return t >= 1 ? b : a;
    }
    const { an, bn } = a.stops.length === b.stops.length ? { an: a.stops, bn: b.stops } : reconcileStops(a.stops, b.stops);
    const stops = lerpStops(an, bn, t);
    if (a.type === "linear" && b.type === "linear") {
      return {
        type: "linear",
        x1: lerp2(a.x1, b.x1, t),
        y1: lerp2(a.y1, b.y1, t),
        x2: lerp2(a.x2, b.x2, t),
        y2: lerp2(a.y2, b.y2, t),
        stops
      };
    }
    if (a.type === "radial" && b.type === "radial") {
      const out = {
        type: "radial",
        cx: lerp2(a.cx, b.cx, t),
        cy: lerp2(a.cy, b.cy, t),
        r: lerp2(a.r, b.r, t),
        stops
      };
      if (a.fx !== void 0 && a.fy !== void 0 && b.fx !== void 0 && b.fy !== void 0) {
        out.fx = lerp2(a.fx, b.fx, t);
        out.fy = lerp2(a.fy, b.fy, t);
      }
      return out;
    }
    return t >= 1 ? b : a;
  }
  function sampleGradient(track, time) {
    if (track.length === 0) {
      throw new Error("sampleGradient: track must contain at least one keyframe");
    }
    const first = track[0];
    const last = track[track.length - 1];
    if (time <= first.time) return first.gradient;
    if (time >= last.time) return last.gradient;
    let a = first;
    let b = last;
    for (let i = 0; i < track.length - 1; i++) {
      if (time >= track[i].time && time < track[i + 1].time) {
        a = track[i];
        b = track[i + 1];
        break;
      }
    }
    const span = b.time - a.time;
    const raw = span === 0 ? 0 : (time - a.time) / span;
    return interpolateGradient(a.gradient, b.gradient, applyEasing(a.easing, raw));
  }

  // ../engine/src/motion.ts
  function clamp01(n) {
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }
  function pointFromFlat(flat, frac) {
    if (flat.pts.length === 0) return { x: 0, y: 0 };
    if (flat.total === 0) return { x: flat.pts[0].x, y: flat.pts[0].y };
    return pointAtLength(flat, clamp01(frac) * flat.total);
  }
  function pointAtFraction(path, frac) {
    return pointFromFlat(flattenPath(path), frac);
  }
  function tangentAngleDeg(path, frac) {
    const flat = flattenPath(path);
    if (flat.pts.length < 2 || flat.total === 0) return 0;
    const f = clamp01(frac);
    const eps = 1e-3;
    const lo = Math.max(0, f - eps);
    const hi = Math.min(1, f + eps);
    const a = pointFromFlat(flat, lo);
    const b = pointFromFlat(flat, hi);
    return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  }

  // ../engine/src/primitives.ts
  var TOP = -Math.PI / 2;
  var ROUND_EPS = 1e-9;
  function vertex(cx, cy, radius, angle) {
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  }
  function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
  }
  function roundCorners(path, radius) {
    const { nodes, closed } = path;
    if (radius <= 0 || nodes.length < 3) return path;
    const n = nodes.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const V = nodes[i].anchor;
      const P = nodes[(i - 1 + n) % n].anchor;
      const N = nodes[(i + 1) % n].anchor;
      const eP = sub(P, V);
      const eN = sub(N, V);
      const lenP = Math.hypot(eP.x, eP.y);
      const lenN = Math.hypot(eN.x, eN.y);
      if (lenP < ROUND_EPS || lenN < ROUND_EPS) {
        out.push({ anchor: { ...V } });
        continue;
      }
      const u = { x: eP.x / lenP, y: eP.y / lenP };
      const w = { x: eN.x / lenN, y: eN.y / lenN };
      const theta = Math.acos(Math.max(-1, Math.min(1, u.x * w.x + u.y * w.y)));
      const t = Math.min(radius / Math.tan(theta / 2), 0.5 * lenP, 0.5 * lenN);
      if (!(t > ROUND_EPS)) {
        out.push({ anchor: { ...V } });
        continue;
      }
      const rEff = t * Math.tan(theta / 2);
      const h = 4 / 3 * rEff * Math.tan((Math.PI - theta) / 4);
      out.push({ anchor: { x: V.x + u.x * t, y: V.y + u.y * t }, out: { x: -u.x * h, y: -u.y * h } });
      out.push({ anchor: { x: V.x + w.x * t, y: V.y + w.y * t }, in: { x: -w.x * h, y: -w.y * h } });
    }
    return { nodes: out, closed };
  }
  function polygonPath(cx, cy, radius, sides, rotation = 0, cornerRadius = 0) {
    const n = Math.max(3, Math.floor(sides));
    const nodes = Array.from({ length: n }, (_, i) => ({
      anchor: vertex(cx, cy, radius, TOP + rotation + i * 2 * Math.PI / n)
    }));
    const path = { nodes, closed: true };
    return cornerRadius > 0 ? roundCorners(path, cornerRadius) : path;
  }
  function starPath(cx, cy, outerRadius, innerRadius, points, rotation = 0, cornerRadius = 0) {
    const p = Math.max(2, Math.floor(points));
    const count = p * 2;
    const step = 2 * Math.PI / count;
    const nodes = Array.from({ length: count }, (_, i) => ({
      anchor: vertex(cx, cy, i % 2 === 0 ? outerRadius : innerRadius, TOP + rotation + i * step)
    }));
    const path = { nodes, closed: true };
    return cornerRadius > 0 ? roundCorners(path, cornerRadius) : path;
  }
  function primitivePathFromSpec(spec) {
    if (spec.kind === "star") {
      return starPath(spec.cx, spec.cy, spec.radius, spec.radius * (spec.innerRatio ?? 0.5), spec.points ?? 5, spec.rotation, spec.cornerRadius);
    }
    return polygonPath(spec.cx, spec.cy, spec.radius, spec.sides ?? 5, spec.rotation, spec.cornerRadius);
  }

  // ../engine/src/sample.ts
  function sampleObject(obj, time, primitive) {
    const resolve = (prop, fallback) => {
      const track = obj.tracks[prop];
      if (track && track.length > 0) {
        return interpolate(track, time, prop === "rotation");
      }
      return fallback;
    };
    const state = { objectId: obj.id };
    for (const prop of ANIMATABLE_PROPERTIES) {
      state[prop] = resolve(prop, obj.base[prop]);
    }
    const geometry = {};
    for (const prop of GEOMETRY_PROPERTIES) {
      const hasTrack = (obj.tracks[prop]?.length ?? 0) > 0;
      const baseValue = obj.shapeBase?.[prop];
      if (hasTrack || baseValue !== void 0) {
        geometry[prop] = resolve(prop, baseValue ?? 0);
      }
    }
    if (Object.keys(geometry).length > 0) {
      state.geometry = geometry;
    }
    if (obj.shapeTrack && obj.shapeTrack.length > 0) {
      state.path = samplePath(obj.shapeTrack, time);
    } else if (primitive) {
      const trackVal = (prop) => {
        const track = obj.tracks[prop];
        return track && track.length > 0 ? interpolate(track, time) : void 0;
      };
      const sides = trackVal("sides");
      const starPoints = trackVal("starPoints");
      const innerRatio = trackVal("innerRatio");
      const primRot = trackVal("primitiveRotation");
      const corner = trackVal("cornerRadius");
      const relevant = primitive.kind === "polygon" ? [sides, primRot, corner] : [starPoints, innerRatio, primRot, corner];
      if (relevant.some((v) => v !== void 0)) {
        state.path = primitivePathFromSpec({
          ...primitive,
          ...primitive.kind === "polygon" && sides !== void 0 ? { sides: Math.max(3, Math.round(sides)) } : {},
          ...primitive.kind === "star" && starPoints !== void 0 ? { points: Math.max(2, Math.round(starPoints)) } : {},
          ...primitive.kind === "star" && innerRatio !== void 0 ? { innerRatio: Math.min(0.99, Math.max(0.01, innerRatio)) } : {},
          ...primRot !== void 0 ? { rotation: primRot * Math.PI / 180 } : {},
          ...corner !== void 0 ? { cornerRadius: Math.max(0, corner) } : {}
        });
      }
    }
    if (obj.colorTracks) {
      for (const prop of ["fill", "stroke"]) {
        const track = obj.colorTracks[prop];
        if (track && track.length > 0) state[prop] = sampleColor(track, time);
      }
    }
    if (obj.gradientTracks) {
      const fillTrack = obj.gradientTracks.fill;
      if (fillTrack && fillTrack.length > 0) state.fillGradient = sampleGradient(fillTrack, time);
      const strokeTrack = obj.gradientTracks.stroke;
      if (strokeTrack && strokeTrack.length > 0) state.strokeGradient = sampleGradient(strokeTrack, time);
    }
    if (obj.dashOffsetTrack && obj.dashOffsetTrack.length > 0) {
      state.strokeDashoffset = interpolate(obj.dashOffsetTrack, time);
    }
    if (obj.trim) {
      const tr = obj.trim;
      const component = (track, base) => track && track.length > 0 ? interpolate(track, time) : base;
      state.trim = {
        start: component(tr.startTrack, tr.start),
        end: component(tr.endTrack, tr.end),
        offset: component(tr.offsetTrack, tr.offset)
      };
    }
    const mp = obj.motionPath;
    if (mp && mp.progress.length > 0) {
      const frac = interpolate(mp.progress, time);
      const p = pointAtFraction(mp.path, frac);
      state.x = p.x;
      state.y = p.y;
      if (mp.orient) {
        state.rotation = tangentAngleDeg(mp.path, frac) + obj.base.rotation;
      }
    }
    return state;
  }
  function resolveAnchor(obj, state, shapeType, pathBox) {
    if (obj.anchorMode !== "fraction") {
      return { anchorX: obj.anchorX, anchorY: obj.anchorY };
    }
    if (shapeType === "path") {
      const box = pathBox ?? { x: 0, y: 0, width: 0, height: 0 };
      return {
        anchorX: box.x + obj.anchorX * box.width,
        anchorY: box.y + obj.anchorY * box.height
      };
    }
    const g = state.geometry ?? {};
    const width = shapeType === "ellipse" ? 2 * (g.radiusX ?? 0) : g.width ?? 0;
    const height = shapeType === "ellipse" ? 2 * (g.radiusY ?? 0) : g.height ?? 0;
    return { anchorX: obj.anchorX * width, anchorY: obj.anchorY * height };
  }

  // ../engine/src/groupTransform.ts
  function parentGroupOf(objects, obj) {
    if (!obj.parentId) return null;
    const g = objects.find((o) => o.id === obj.parentId && o.isGroup);
    return g ?? null;
  }
  function groupDescendantIds(objects, groupId) {
    const out = /* @__PURE__ */ new Set();
    const walk2 = (pid) => {
      for (const o of objects) {
        if (o.parentId !== pid || out.has(o.id)) continue;
        out.add(o.id);
        walk2(o.id);
      }
    };
    walk2(groupId);
    out.delete(groupId);
    return out;
  }
  function isRenderHidden(obj, objectsById) {
    if (obj.hidden) return true;
    const seen = /* @__PURE__ */ new Set();
    let pid = obj.parentId;
    while (pid && !seen.has(pid)) {
      seen.add(pid);
      const p = objectsById.get(pid);
      if (!p?.isGroup) break;
      if (p.hidden) return true;
      pid = p.parentId;
    }
    return false;
  }
  function groupTransformPrefix(objects, obj, time) {
    const parts = [];
    const seen = /* @__PURE__ */ new Set();
    let cur = parentGroupOf(objects, obj);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.push(buildTransform(sampleObject(cur, time), cur.anchorX, cur.anchorY));
      cur = parentGroupOf(objects, cur);
    }
    return parts.reverse().join(" ");
  }
  function mapPoint(t, ax, ay, px, py) {
    const rad = t.rotation * Math.PI / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const ex = t.scaleX * (px - ax);
    const ey = t.scaleY * (py - ay);
    return { x: t.x + ax + (c * ex - s * ey), y: t.y + ay + (s * ex + c * ey) };
  }
  function worldChain(project, obj, ax, ay, time) {
    const chain = [{ state: sampleObject(obj, time), ax, ay }];
    let cur = parentGroupOf(project.objects, obj);
    const seen = /* @__PURE__ */ new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.push({ state: sampleObject(cur, time), ax: cur.anchorX, ay: cur.anchorY });
      cur = parentGroupOf(project.objects, cur);
    }
    return chain;
  }
  function applyWorldChain(chain, p) {
    let q = p;
    for (const link of chain) {
      q = mapPoint(link.state, link.ax, link.ay, q.x, q.y);
    }
    return q;
  }
  function worldTransformNode(chain, n) {
    const worldAnchor = applyWorldChain(chain, n.anchor);
    const node = { anchor: worldAnchor };
    if (n.in) {
      const worldAbs = applyWorldChain(chain, { x: n.anchor.x + n.in.x, y: n.anchor.y + n.in.y });
      node.in = { x: worldAbs.x - worldAnchor.x, y: worldAbs.y - worldAnchor.y };
    }
    if (n.out) {
      const worldAbs = applyWorldChain(chain, { x: n.anchor.x + n.out.x, y: n.anchor.y + n.out.y });
      node.out = { x: worldAbs.x - worldAnchor.x, y: worldAbs.y - worldAnchor.y };
    }
    return node;
  }

  // ../engine/src/gradient.ts
  var clamp012 = (n) => Math.max(0, Math.min(1, n));
  function gradientStopAttrs(s) {
    const attrs = {
      offset: fmt(clamp012(s.offset)),
      "stop-color": s.color
    };
    if (s.opacity !== void 0 && s.opacity < 1) attrs["stop-opacity"] = fmt(clamp012(s.opacity));
    return attrs;
  }
  function gradientAttrs(g) {
    if (g.type === "linear") {
      return { x1: fmt(g.x1), y1: fmt(g.y1), x2: fmt(g.x2), y2: fmt(g.y2) };
    }
    const attrs = { cx: fmt(g.cx), cy: fmt(g.cy), r: fmt(g.r) };
    if (g.fx !== void 0) attrs.fx = fmt(g.fx);
    if (g.fy !== void 0) attrs.fy = fmt(g.fy);
    return attrs;
  }

  // ../engine/src/trim.ts
  function trimToDashAttrs(trim) {
    const visible = Math.min(1, Math.max(0, trim.end - trim.start));
    const phase = ((trim.start + trim.offset) % 1 + 1) % 1;
    return {
      "stroke-dasharray": `${fmt(visible)} ${fmt(1 - visible)}`,
      "stroke-dashoffset": fmt(phase === 0 ? 0 : -phase),
      pathLength: "1"
    };
  }

  // ../engine/src/renderShape.ts
  function geometryToSvgAttrs(shapeType, geometry) {
    if (shapeType === "rect") {
      const attrs = {
        x: fmt(0),
        y: fmt(0),
        width: fmt(Math.max(0, geometry.width ?? 0)),
        height: fmt(Math.max(0, geometry.height ?? 0))
      };
      if (geometry.cornerRadius !== void 0) {
        const r = fmt(Math.max(0, geometry.cornerRadius));
        attrs.rx = r;
        attrs.ry = r;
      }
      return attrs;
    }
    const rx = Math.max(0, geometry.radiusX ?? 0);
    const ry = Math.max(0, geometry.radiusY ?? 0);
    return { cx: fmt(rx), cy: fmt(ry), rx: fmt(rx), ry: fmt(ry) };
  }

  // ../engine/src/geom/boolean.ts
  var polygonClippingNs = __toESM(require_polygon_clipping_umd(), 1);

  // ../engine/src/geom/boolean-curves.ts
  var lerp3 = (a, b, t) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  });
  function evalCubic(c, t) {
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const d = 3 * u * t * t;
    const e = t * t * t;
    return {
      x: a * c.p0.x + b * c.c1.x + d * c.c2.x + e * c.p3.x,
      y: a * c.p0.y + b * c.c1.y + d * c.c2.y + e * c.p3.y
    };
  }
  function reverseCubic(c) {
    return { p0: c.p3, c1: c.c2, c2: c.c1, p3: c.p0 };
  }
  function splitLeft(c, t) {
    const ab = lerp3(c.p0, c.c1, t);
    const bc = lerp3(c.c1, c.c2, t);
    const cd = lerp3(c.c2, c.p3, t);
    const abc = lerp3(ab, bc, t);
    const bcd = lerp3(bc, cd, t);
    const p = lerp3(abc, bcd, t);
    return { p0: c.p0, c1: ab, c2: abc, p3: p };
  }
  function splitRight(c, t) {
    const ab = lerp3(c.p0, c.c1, t);
    const bc = lerp3(c.c1, c.c2, t);
    const cd = lerp3(c.c2, c.p3, t);
    const abc = lerp3(ab, bc, t);
    const bcd = lerp3(bc, cd, t);
    const p = lerp3(abc, bcd, t);
    return { p0: p, c1: bcd, c2: cd, p3: c.p3 };
  }
  function splitCubicRange(c, t0, t1) {
    const lo = Math.min(t0, t1);
    const hi = Math.max(t0, t1);
    const right = splitRight(c, lo);
    const remapped = lo >= 1 ? 1 : (hi - lo) / (1 - lo);
    const sub2 = splitLeft(right, Math.min(1, Math.max(0, remapped)));
    return t0 <= t1 ? sub2 : reverseCubic(sub2);
  }
  function projectToCubic(c, p) {
    const d2 = (q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    const SEED = 24;
    let bestT = 0;
    let bestD = Infinity;
    for (let i = 0; i <= SEED; i++) {
      const t2 = i / SEED;
      const dd = d2(evalCubic(c, t2));
      if (dd < bestD) {
        bestD = dd;
        bestT = t2;
      }
    }
    let lo = Math.max(0, bestT - 1 / SEED);
    let hi = Math.min(1, bestT + 1 / SEED);
    for (let i = 0; i < 40; i++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (d2(evalCubic(c, m1)) < d2(evalCubic(c, m2))) hi = m2;
      else lo = m1;
    }
    const t = (lo + hi) / 2;
    return { t, dist: Math.sqrt(d2(evalCubic(c, t))) };
  }
  function classifyVertex(operands, p, tol) {
    let best = null;
    let bestDist = tol;
    for (const op of operands) {
      for (let segIdx = 0; segIdx < op.segs.length; segIdx++) {
        const { t, dist: dist2 } = projectToCubic(op.segs[segIdx], p);
        if (dist2 < bestDist) {
          bestDist = dist2;
          best = { opIdx: op.opIdx, segIdx, t };
        }
      }
    }
    return best;
  }
  var DEFAULT_STEPS = 16;
  function cubicsToRing(cubics, steps = DEFAULT_STEPS) {
    if (cubics.length === 0) return [];
    const n = Math.max(1, Math.floor(steps));
    const ring = [];
    for (const c of cubics) {
      for (let s = 0; s < n; s++) {
        const p = evalCubic(c, s / n);
        ring.push([p.x, p.y]);
      }
    }
    ring.push([ring[0][0], ring[0][1]]);
    return ring;
  }
  function isStraightCubic(c, eps = 1e-6) {
    const vx = c.p3.x - c.p0.x;
    const vy = c.p3.y - c.p0.y;
    const len = Math.hypot(vx, vy);
    if (len < eps) return true;
    const cross = (q) => Math.abs((q.x - c.p0.x) * vy - (q.y - c.p0.y) * vx) / len;
    return cross(c.c1) < eps && cross(c.c2) < eps;
  }
  var segStart = (s) => s.kind === "line" ? s.a : s.c.p0;
  var segEnd = (s) => s.kind === "line" ? s.b : s.c.p3;
  function segmentsToPathData(segs) {
    const n = segs.length;
    const nodes = [];
    for (let i = 0; i < n; i++) {
      const outgoing = segs[i];
      const incoming = segs[(i - 1 + n) % n];
      const anchor = segStart(outgoing);
      const node = { anchor };
      if (outgoing.kind === "cubic" && !isStraightCubic(outgoing.c)) {
        node.out = { x: outgoing.c.c1.x - anchor.x, y: outgoing.c.c1.y - anchor.y };
      }
      if (incoming.kind === "cubic" && !isStraightCubic(incoming.c)) {
        const end = segEnd(incoming);
        node.in = { x: incoming.c.c2.x - end.x, y: incoming.c.c2.y - end.y };
      }
      nodes.push(node);
    }
    return { closed: true, nodes };
  }
  function stripClose(ring) {
    if (ring.length > 1) {
      const f = ring[0];
      const l = ring[ring.length - 1];
      if (f[0] === l[0] && f[1] === l[1]) return ring.slice(0, -1);
    }
    return ring;
  }
  function cornersOnly(verts) {
    return { closed: true, nodes: verts.map(([x, y]) => ({ anchor: { x, y } })) };
  }
  function reconstructRing(ring, operands, tol) {
    const verts = stripClose(ring);
    if (verts.length < 3) return null;
    const pt = (i2) => ({ x: verts[i2][0], y: verts[i2][1] });
    const prov = verts.map((v) => classifyVertex(operands, { x: v[0], y: v[1] }, tol));
    const firstOp = prov[0]?.opIdx;
    const verbatim = firstOp !== void 0 && prov.every((p) => p !== null && p.opIdx === firstOp);
    if (verbatim) {
      const operand = operands.find((o) => o.opIdx === firstOp);
      if (operand && operand.segs.length >= 2) {
        const pd2 = segmentsToPathData(operand.segs.map((c) => ({ kind: "cubic", c })));
        if (pd2.nodes.length >= 3) return pd2;
      }
    }
    const n = verts.length;
    const sameRun = (i2, j) => {
      const a = prov[i2];
      const b = prov[j];
      return !!a && !!b && a.opIdx === b.opIdx && a.segIdx === b.segIdx;
    };
    const segOfProv = (p) => operands.find((o) => o.opIdx === p.opIdx).segs[p.segIdx];
    const ptOf = (idx) => {
      const p = prov[idx];
      return p ? evalCubic(segOfProv(p), p.t) : pt(idx);
    };
    let start = 0;
    for (let i2 = 0; i2 < n; i2++) {
      if (!sameRun((i2 - 1 + n) % n, i2)) {
        start = i2;
        break;
      }
    }
    const segs = [];
    let i = 0;
    while (i < n) {
      const idx = (start + i) % n;
      const p = prov[idx];
      if (!p) {
        segs.push({ kind: "line", a: ptOf(idx), b: ptOf((start + i + 1) % n) });
        i += 1;
        continue;
      }
      let j = i;
      while (j + 1 < n && sameRun((start + j) % n, (start + j + 1) % n)) j += 1;
      const aIdx = (start + i) % n;
      const bIdx = (start + j) % n;
      const cubic2 = segOfProv(p);
      if (isStraightCubic(cubic2)) {
        segs.push({ kind: "line", a: ptOf(aIdx), b: ptOf(bIdx) });
      } else {
        segs.push({ kind: "cubic", c: splitCubicRange(cubic2, p.t, prov[bIdx].t) });
      }
      if (j + 1 < n) {
        const e = ptOf(bIdx);
        const s = ptOf((start + j + 1) % n);
        if (Math.hypot(s.x - e.x, s.y - e.y) > 1e-9) segs.push({ kind: "line", a: e, b: s });
      }
      i = j + 1;
    }
    if (segs.length >= 2) {
      const lastEnd = segEnd(segs[segs.length - 1]);
      const firstStart = segStart(segs[0]);
      if (Math.hypot(firstStart.x - lastEnd.x, firstStart.y - lastEnd.y) > 1e-9) {
        segs.push({ kind: "line", a: lastEnd, b: firstStart });
      }
    }
    const pd = segmentsToPathData(segs);
    return pd.nodes.length >= 3 ? pd : cornersOnly(verts);
  }

  // ../engine/src/geom/svg/parsePathD.ts
  var CMD = "MmLlHhVvCcSsQqTtAaZz";
  function parsePathD(d) {
    const out = [];
    const n = d.length;
    let i = 0;
    let cx = 0;
    let cy = 0;
    let sx = 0;
    let sy = 0;
    let pcx = 0;
    let pcy = 0;
    let pqx = 0;
    let pqy = 0;
    let lastCubic = false;
    let lastQuad = false;
    const isSep = (c) => c === " " || c === "	" || c === "\n" || c === "\r" || c === "\f" || c === ",";
    const skipSep = () => {
      while (i < n && isSep(d[i])) i++;
    };
    const num2 = () => {
      skipSep();
      const s = i;
      if (i < n && (d[i] === "+" || d[i] === "-")) i++;
      let digit = false;
      while (i < n && d[i] >= "0" && d[i] <= "9") {
        i++;
        digit = true;
      }
      if (i < n && d[i] === ".") {
        i++;
        while (i < n && d[i] >= "0" && d[i] <= "9") {
          i++;
          digit = true;
        }
      }
      if (!digit) {
        i = s;
        return NaN;
      }
      if (i < n && (d[i] === "e" || d[i] === "E")) {
        const save = i;
        i++;
        if (i < n && (d[i] === "+" || d[i] === "-")) i++;
        let exp = false;
        while (i < n && d[i] >= "0" && d[i] <= "9") {
          i++;
          exp = true;
        }
        if (!exp) i = save;
      }
      return parseFloat(d.slice(s, i));
    };
    const flag = () => {
      skipSep();
      if (i < n && (d[i] === "0" || d[i] === "1")) {
        const v = d[i] === "1" ? 1 : 0;
        i++;
        return v;
      }
      return NaN;
    };
    const numAhead = () => {
      skipSep();
      if (i >= n) return false;
      const c = d[i];
      return c === "+" || c === "-" || c === "." || c >= "0" && c <= "9";
    };
    while (i < n) {
      skipSep();
      if (i >= n) break;
      const ch = d[i];
      if (!CMD.includes(ch)) break;
      i++;
      const up = ch.toUpperCase();
      const rel = ch !== up;
      if (up === "Z") {
        out.push({ type: "Z" });
        cx = sx;
        cy = sy;
        lastCubic = lastQuad = false;
        continue;
      }
      let pair = 0;
      for (; ; ) {
        if (pair > 0 && !numAhead()) break;
        if (up === "M" || up === "L") {
          let x = num2();
          let y = num2();
          if (Number.isNaN(x) || Number.isNaN(y)) return out;
          if (rel) {
            x += cx;
            y += cy;
          }
          const type = up === "M" && pair === 0 ? "M" : "L";
          out.push({ type, x, y });
          cx = x;
          cy = y;
          if (type === "M") {
            sx = x;
            sy = y;
          }
          lastCubic = lastQuad = false;
        } else if (up === "H") {
          let x = num2();
          if (Number.isNaN(x)) return out;
          if (rel) x += cx;
          out.push({ type: "L", x, y: cy });
          cx = x;
          lastCubic = lastQuad = false;
        } else if (up === "V") {
          let y = num2();
          if (Number.isNaN(y)) return out;
          if (rel) y += cy;
          out.push({ type: "L", x: cx, y });
          cy = y;
          lastCubic = lastQuad = false;
        } else if (up === "C") {
          let x1 = num2();
          let y1 = num2();
          let x2 = num2();
          let y2 = num2();
          let x = num2();
          let y = num2();
          if ([x1, y1, x2, y2, x, y].some(Number.isNaN)) return out;
          if (rel) {
            x1 += cx;
            y1 += cy;
            x2 += cx;
            y2 += cy;
            x += cx;
            y += cy;
          }
          out.push({ type: "C", x1, y1, x2, y2, x, y });
          pcx = x2;
          pcy = y2;
          cx = x;
          cy = y;
          lastCubic = true;
          lastQuad = false;
        } else if (up === "S") {
          let x2 = num2();
          let y2 = num2();
          let x = num2();
          let y = num2();
          if ([x2, y2, x, y].some(Number.isNaN)) return out;
          if (rel) {
            x2 += cx;
            y2 += cy;
            x += cx;
            y += cy;
          }
          const x1 = lastCubic ? 2 * cx - pcx : cx;
          const y1 = lastCubic ? 2 * cy - pcy : cy;
          out.push({ type: "C", x1, y1, x2, y2, x, y });
          pcx = x2;
          pcy = y2;
          cx = x;
          cy = y;
          lastCubic = true;
          lastQuad = false;
        } else if (up === "Q") {
          let x1 = num2();
          let y1 = num2();
          let x = num2();
          let y = num2();
          if ([x1, y1, x, y].some(Number.isNaN)) return out;
          if (rel) {
            x1 += cx;
            y1 += cy;
            x += cx;
            y += cy;
          }
          out.push({ type: "Q", x1, y1, x, y });
          pqx = x1;
          pqy = y1;
          cx = x;
          cy = y;
          lastQuad = true;
          lastCubic = false;
        } else if (up === "T") {
          let x = num2();
          let y = num2();
          if (Number.isNaN(x) || Number.isNaN(y)) return out;
          if (rel) {
            x += cx;
            y += cy;
          }
          const x1 = lastQuad ? 2 * cx - pqx : cx;
          const y1 = lastQuad ? 2 * cy - pqy : cy;
          out.push({ type: "Q", x1, y1, x, y });
          pqx = x1;
          pqy = y1;
          cx = x;
          cy = y;
          lastQuad = true;
          lastCubic = false;
        } else if (up === "A") {
          const rx = num2();
          const ry = num2();
          const rot = num2();
          const large = flag();
          const sweep = flag();
          let x = num2();
          let y = num2();
          if ([rx, ry, rot, large, sweep, x, y].some(Number.isNaN)) return out;
          if (rel) {
            x += cx;
            y += cy;
          }
          out.push({ type: "A", rx, ry, rot, large: large === 1, sweep: sweep === 1, x, y });
          cx = x;
          cy = y;
          lastCubic = lastQuad = false;
        }
        pair++;
      }
    }
    return out;
  }

  // ../engine/src/geom/svg/flattenSvg.ts
  var IDENTITY = [1, 0, 0, 1, 0, 0];
  var SVG_CIRCLE_STEPS = 64;
  var FLATTEN_STEPS2 = 16;
  var ARC_STEPS = 16;
  var apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  function compose(a, b) {
    return [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5]
    ];
  }
  var nums = (s) => s.trim().split(/[\s,]+/).filter((t) => t.length > 0).map(Number);
  function parseTransformList(s) {
    if (!s) return IDENTITY;
    let m = IDENTITY;
    const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
    let match;
    while ((match = re.exec(s)) !== null) {
      const name = match[1];
      const a = nums(match[2]);
      let t = null;
      if (name === "matrix" && a.length === 6) t = [a[0], a[1], a[2], a[3], a[4], a[5]];
      else if (name === "translate") t = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
      else if (name === "scale") {
        const sx = Number.isFinite(a[0]) ? a[0] : 1;
        const sy = Number.isFinite(a[1]) ? a[1] : sx;
        t = [sx, 0, 0, sy, 0, 0];
      } else if (name === "rotate") {
        const r = (a[0] || 0) * Math.PI / 180;
        const rot = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
        t = a.length >= 3 ? compose(compose([1, 0, 0, 1, a[1], a[2]], rot), [1, 0, 0, 1, -a[1], -a[2]]) : rot;
      } else if (name === "skewX") t = [1, 0, Math.tan((a[0] || 0) * Math.PI / 180), 1, 0, 0];
      else if (name === "skewY") t = [1, Math.tan((a[0] || 0) * Math.PI / 180), 0, 1, 0, 0];
      if (t) m = compose(m, t);
    }
    return m;
  }
  var num = (el, name, def = 0) => {
    const v = parseFloat(el.getAttribute(name) ?? "");
    return Number.isFinite(v) ? v : def;
  };
  function cubic(p0, c1, c2, p3, out) {
    for (let s = 1; s <= FLATTEN_STEPS2; s++) {
      const t = s / FLATTEN_STEPS2;
      const u = 1 - t;
      out.push([
        u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]
      ]);
    }
  }
  function quad(p0, c, p1, out) {
    for (let s = 1; s <= FLATTEN_STEPS2; s++) {
      const t = s / FLATTEN_STEPS2;
      const u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]);
    }
  }
  function arc(p0, rxIn, ryIn, rotDeg, large, sweep, end, out) {
    let rx = Math.abs(rxIn);
    let ry = Math.abs(ryIn);
    if (rx === 0 || ry === 0) {
      out.push(end);
      return;
    }
    const phi = rotDeg * Math.PI / 180;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);
    const dx = (p0[0] - end[0]) / 2;
    const dy = (p0[1] - end[1]) / 2;
    const x1p = cosP * dx + sinP * dy;
    const y1p = -sinP * dx + cosP * dy;
    const lambda = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
    if (lambda > 1) {
      const s = Math.sqrt(lambda);
      rx *= s;
      ry *= s;
    }
    const sign = large !== sweep ? 1 : -1;
    const numr = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const denom = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const co = sign * Math.sqrt(Math.max(0, numr / denom));
    const cxp = co * (rx * y1p) / ry;
    const cyp = co * -(ry * x1p) / rx;
    const cx = cosP * cxp - sinP * cyp + (p0[0] + end[0]) / 2;
    const cy = sinP * cxp + cosP * cyp + (p0[1] + end[1]) / 2;
    const ang = (ux, uy, vx, vy) => {
      const dot = ux * vx + uy * vy;
      const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
      let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
      if (ux * vy - uy * vx < 0) a = -a;
      return a;
    };
    const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let delta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && delta > 0) delta -= 2 * Math.PI;
    if (sweep && delta < 0) delta += 2 * Math.PI;
    for (let s = 1; s <= ARC_STEPS; s++) {
      const th = theta1 + delta * s / ARC_STEPS;
      const ex = Math.cos(th) * rx;
      const ey = Math.sin(th) * ry;
      out.push([cx + cosP * ex - sinP * ey, cy + sinP * ex + cosP * ey]);
    }
  }
  function flattenElementToRings(el, ctm) {
    const tag = el.tagName.toLowerCase();
    const rings = [];
    const push = (pts) => {
      if (pts.length >= 3) rings.push(pts.map(([x, y]) => apply(ctm, x, y)));
    };
    if (tag === "rect") {
      const x = num(el, "x");
      const y = num(el, "y");
      const w = num(el, "width");
      const h = num(el, "height");
      if (w > 0 && h > 0) push([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
    } else if (tag === "circle" || tag === "ellipse") {
      const cx = num(el, "cx");
      const cy = num(el, "cy");
      const rx = tag === "circle" ? num(el, "r") : num(el, "rx");
      const ry = tag === "circle" ? num(el, "r") : num(el, "ry");
      if (rx > 0 && ry > 0) {
        const pts = [];
        for (let s = 0; s < SVG_CIRCLE_STEPS; s++) {
          const t = s / SVG_CIRCLE_STEPS * 2 * Math.PI;
          pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
        }
        push(pts);
      }
    } else if (tag === "polygon") {
      const pts = nums(el.getAttribute("points") ?? "");
      const ring = [];
      for (let k = 0; k + 1 < pts.length; k += 2) ring.push([pts[k], pts[k + 1]]);
      push(ring);
    } else if (tag === "path") {
      const cmds = parsePathD(el.getAttribute("d") ?? "");
      let ring = [];
      let px = 0;
      let py = 0;
      let startX = 0;
      let startY = 0;
      for (const c of cmds) {
        if (c.type === "M") {
          push(ring);
          ring = [[c.x, c.y]];
          px = startX = c.x;
          py = startY = c.y;
        } else if (c.type === "L") {
          ring.push([c.x, c.y]);
          px = c.x;
          py = c.y;
        } else if (c.type === "C") {
          cubic([px, py], [c.x1, c.y1], [c.x2, c.y2], [c.x, c.y], ring);
          px = c.x;
          py = c.y;
        } else if (c.type === "Q") {
          quad([px, py], [c.x1, c.y1], [c.x, c.y], ring);
          px = c.x;
          py = c.y;
        } else if (c.type === "A") {
          arc([px, py], c.rx, c.ry, c.rot, c.large, c.sweep, [c.x, c.y], ring);
          px = c.x;
          py = c.y;
        } else if (c.type === "Z") {
          push(ring);
          ring = [];
          px = startX;
          py = startY;
        }
      }
      push(ring);
    }
    return rings;
  }
  function walk(node, ctm, out) {
    for (const child of Array.from(node.children)) {
      const local = compose(ctm, parseTransformList(child.getAttribute("transform")));
      const tag = child.tagName.toLowerCase();
      if (tag === "g" || tag === "svg") {
        walk(child, local, out);
      } else {
        try {
          out.push(...flattenElementToRings(child, local));
        } catch {
        }
      }
    }
  }
  function svgAssetRings(asset) {
    let root;
    try {
      root = new DOMParser().parseFromString(asset.normalizedContent, "image/svg+xml").documentElement;
    } catch {
      return [];
    }
    if (!root || root.tagName === "parsererror") return [];
    const vb = nums(asset.viewBox || root.getAttribute("viewBox") || "");
    let base = IDENTITY;
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      base = compose([asset.width / vb[2], 0, 0, asset.height / vb[3], 0, 0], [1, 0, 0, 1, -vb[0], -vb[1]]);
    }
    const out = [];
    walk(root, base, out);
    return out.filter((r) => r.length >= 3);
  }

  // ../engine/src/geom/boolean.ts
  var pc = polygonClippingNs.default ?? polygonClippingNs;
  var ELLIPSE_STEPS = 64;
  var EMPTY_PATH = { nodes: [], closed: false };
  function assetOf(project, obj) {
    const a = project.assets.find((x) => x.id === obj.assetId);
    return a && a.kind === "vector" ? a : void 0;
  }
  function svgAssetOf(project, obj) {
    const a = project.assets.find((x) => x.id === obj.assetId);
    return a && a.kind === "svg" ? a : void 0;
  }
  function effectivePath(obj, asset, time) {
    if (obj.shapeTrack && obj.shapeTrack.length > 0) return samplePath(obj.shapeTrack, time);
    return sampleObject(obj, time).path ?? asset.path ?? EMPTY_PATH;
  }
  function localOutline(obj, asset, time) {
    if (asset.shapeType === "path") {
      const path = effectivePath(obj, asset, time);
      if (path.nodes.length < 2) return null;
      const pts = flattenPath(path).pts.map((p) => ({ x: p.x, y: p.y }));
      if (pts.length > 1) {
        const f = pts[0];
        const l = pts[pts.length - 1];
        if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9) pts.pop();
      }
      return pts.length >= 3 ? pts : null;
    }
    const g = sampleObject(obj, time).geometry ?? {};
    if (asset.shapeType === "rect") {
      const w = Math.max(0, g.width ?? 0);
      const h = Math.max(0, g.height ?? 0);
      if (w === 0 || h === 0) return null;
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h }
      ];
    }
    const rx = Math.max(0, g.radiusX ?? 0);
    const ry = Math.max(0, g.radiusY ?? 0);
    if (rx === 0 || ry === 0) return null;
    const out = [];
    for (let i = 0; i < ELLIPSE_STEPS; i++) {
      const t = i / ELLIPSE_STEPS * 2 * Math.PI;
      out.push({ x: rx + rx * Math.cos(t), y: ry + ry * Math.sin(t) });
    }
    return out;
  }
  function toWorld(project, obj, ax, ay, p, time) {
    let q = mapPoint(sampleObject(obj, time), ax, ay, p.x, p.y);
    let cur = parentGroupOf(project.objects, obj);
    const seen = /* @__PURE__ */ new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      q = mapPoint(sampleObject(cur, time), cur.anchorX, cur.anchorY, q.x, q.y);
      cur = parentGroupOf(project.objects, cur);
    }
    return q;
  }
  function objectToWorldPolygon(project, obj, time) {
    const asset = assetOf(project, obj);
    if (!asset) return [];
    const local = localOutline(obj, asset, time);
    if (!local) return [];
    const state = sampleObject(obj, time);
    const box = asset.shapeType === "path" ? pathBounds(effectivePath(obj, asset, time)) : void 0;
    const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, box);
    const ring = local.map((p) => {
      const w = toWorld(project, obj, anchorX, anchorY, p, time);
      return [w.x, w.y];
    });
    ring.push([ring[0][0], ring[0][1]]);
    return [ring];
  }
  var KAPPA = 0.5522847498;
  function localCubics(obj, asset, time) {
    const straight = (a, b) => ({ p0: a, c1: a, c2: b, p3: b });
    if (asset.shapeType === "rect") {
      const g = sampleObject(obj, time).geometry ?? {};
      const w = Math.max(0, g.width ?? 0);
      const h = Math.max(0, g.height ?? 0);
      if (w === 0 || h === 0) return null;
      const c = [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h }
      ];
      return [straight(c[0], c[1]), straight(c[1], c[2]), straight(c[2], c[3]), straight(c[3], c[0])];
    }
    if (asset.shapeType === "ellipse") {
      const g = sampleObject(obj, time).geometry ?? {};
      const rx = Math.max(0, g.radiusX ?? 0);
      const ry = Math.max(0, g.radiusY ?? 0);
      if (rx === 0 || ry === 0) return null;
      const A0 = { x: rx + rx, y: ry };
      const A1 = { x: rx, y: ry + ry };
      const A2 = { x: 0, y: ry };
      const A3 = { x: rx, y: 0 };
      const kx = KAPPA * rx;
      const ky = KAPPA * ry;
      return [
        { p0: A0, c1: { x: A0.x, y: A0.y + ky }, c2: { x: A1.x + kx, y: A1.y }, p3: A1 },
        { p0: A1, c1: { x: A1.x - kx, y: A1.y }, c2: { x: A2.x, y: A2.y + ky }, p3: A2 },
        { p0: A2, c1: { x: A2.x, y: A2.y - ky }, c2: { x: A3.x - kx, y: A3.y }, p3: A3 },
        { p0: A3, c1: { x: A3.x + kx, y: A3.y }, c2: { x: A0.x, y: A0.y - ky }, p3: A0 }
      ];
    }
    const path = effectivePath(obj, asset, time);
    const nodes = path.nodes;
    if (nodes.length < 2) return null;
    const add3 = (a, off) => off ? { x: a.x + off.x, y: a.y + off.y } : a;
    const segOf = (prev, cur) => {
      if (prev.out || cur.in) {
        return { p0: prev.anchor, c1: add3(prev.anchor, prev.out), c2: add3(cur.anchor, cur.in), p3: cur.anchor };
      }
      return straight(prev.anchor, cur.anchor);
    };
    const out = [];
    const push = (s) => {
      if (Math.hypot(s.p3.x - s.p0.x, s.p3.y - s.p0.y) > 1e-9 || s.c1 !== s.p0 || s.c2 !== s.p3) out.push(s);
    };
    for (let i = 1; i < nodes.length; i++) push(segOf(nodes[i - 1], nodes[i]));
    if (path.closed && nodes.length > 1) push(segOf(nodes[nodes.length - 1], nodes[0]));
    return out.length >= 2 ? out : null;
  }
  function operandCubicsWorld(project, obj, time) {
    if (obj.boolean) return [];
    if (obj.isGroup) return [];
    const asset = assetOf(project, obj);
    if (!asset) return [];
    const local = localCubics(obj, asset, time);
    if (!local) return [];
    const state = sampleObject(obj, time);
    const box = asset.shapeType === "path" ? pathBounds(effectivePath(obj, asset, time)) : void 0;
    const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, box);
    const w = (p) => toWorld(project, obj, anchorX, anchorY, p, time);
    return local.map((c) => ({ p0: w(c.p0), c1: w(c.c1), c2: w(c.c2), p3: w(c.p3) }));
  }
  function ringToPathData(ring) {
    const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
    const pts = closed ? ring.slice(0, -1) : ring;
    return { closed: true, nodes: pts.map(([x, y]) => ({ anchor: { x, y } })) };
  }
  function collectVectorLeaves(project, groupId, out, seen) {
    if (seen.has(groupId)) return;
    seen.add(groupId);
    for (const o of project.objects) {
      if (o.parentId !== groupId) continue;
      if (o.isGroup) collectVectorLeaves(project, o.id, out, seen);
      else if (assetOf(project, o)) out.push(o);
    }
  }
  function operandWorldGeom(project, obj, time, visited = /* @__PURE__ */ new Set()) {
    if (obj.boolean) return resolveBooleanGeom(project, obj, time, visited);
    const svg = svgAssetOf(project, obj);
    if (svg) {
      const state = sampleObject(obj, time);
      const { anchorX, anchorY } = resolveAnchor(obj, state, void 0);
      const world = svgAssetRings(svg).map((r) => r.map(([x, y]) => {
        const w = toWorld(project, obj, anchorX, anchorY, { x, y }, time);
        return [w.x, w.y];
      })).filter((r) => r.length >= 3).map((r) => [...r, r[0]]);
      if (world.length === 0) return [];
      return world.length === 1 ? [world[0]] : pc.union([world[0]], ...world.slice(1).map((r) => [r]));
    }
    if (!obj.isGroup) return objectToWorldPolygon(project, obj, time);
    const leaves = [];
    collectVectorLeaves(project, obj.id, leaves, /* @__PURE__ */ new Set());
    const polys = leaves.map((l) => operandWorldGeom(project, l, time, visited)).filter((g) => g.length > 0);
    if (polys.length === 0) return [];
    if (polys.length === 1) return polys[0];
    return pc.union(polys[0], ...polys.slice(1));
  }
  function booleanResultGeom(project, objs, op, time, visited) {
    const sorted = objs.slice().sort((a, b) => a.zOrder - b.zOrder);
    const operands = [];
    const geoms = [];
    let opIdx = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const fold = (x, y) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };
    for (const o of sorted) {
      const cubics = operandCubicsWorld(project, o, time);
      if (cubics.length >= 2) {
        const id = opIdx++;
        operands.push({ opIdx: id, segs: cubics });
        const ring = cubicsToRing(cubics);
        for (const [x, y] of ring) fold(x, y);
        geoms.push([ring]);
      } else if (o.isGroup) {
        const leaves = [];
        collectVectorLeaves(project, o.id, leaves, /* @__PURE__ */ new Set());
        for (const leaf of leaves) {
          const lc = operandCubicsWorld(project, leaf, time);
          if (lc.length >= 2) {
            operands.push({ opIdx: opIdx++, segs: lc });
            const lr = cubicsToRing(lc);
            for (const [x, y] of lr) fold(x, y);
          }
        }
        const g = operandWorldGeom(project, o, time, visited);
        if (g.length > 0) geoms.push(g);
      } else {
        const g = operandWorldGeom(project, o, time, visited);
        if (g.length > 0) geoms.push(g);
      }
    }
    if (geoms.length < 2) return null;
    const head = geoms[0];
    const rest = geoms.slice(1);
    let result;
    if (op === "union") result = pc.union(head, ...rest);
    else if (op === "intersect") result = pc.intersection(head, ...rest);
    else if (op === "exclude") result = pc.xor(head, ...rest);
    else result = pc.difference(head, ...rest);
    const diag = Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY) : 0;
    const tol = Math.max(1e-4, diag * 1e-4);
    return { result, operands, tol };
  }
  function booleanOp(project, objs, op, time, visited = /* @__PURE__ */ new Set()) {
    const g = booleanResultGeom(project, objs, op, time, visited);
    if (!g) return [];
    const { result, operands, tol } = g;
    const rings = [];
    for (const poly of result) {
      for (const ring of poly) {
        let pd = null;
        if (operands.length > 0) {
          try {
            pd = reconstructRing(ring, operands, tol);
          } catch {
            pd = null;
          }
        }
        const final = pd ?? ringToPathData(ring);
        if (final.nodes.length >= 3) rings.push(final);
      }
    }
    return rings;
  }
  function resolveBooleanGeom(project, booleanObj, time, visited) {
    const spec = booleanObj.boolean;
    if (!spec) return [];
    if (visited.has(booleanObj.id)) return [];
    const next = new Set(visited);
    next.add(booleanObj.id);
    const operands = spec.operandIds.map((id) => project.objects.find((o) => o.id === id)).filter((o) => !!o);
    if (operands.length < 2) return [];
    return booleanResultGeom(project, operands, spec.op, time, next)?.result ?? [];
  }
  function resolveBooleanRings(project, booleanObj, time, visited = /* @__PURE__ */ new Set()) {
    const spec = booleanObj.boolean;
    if (!spec) return [];
    if (visited.has(booleanObj.id)) return [];
    const next = new Set(visited);
    next.add(booleanObj.id);
    const operands = spec.operandIds.map((id) => project.objects.find((o) => o.id === id)).filter((o) => !!o);
    if (operands.length < 2) return [];
    return booleanOp(project, operands, spec.op, time, next);
  }

  // ../engine/src/geom/strokeOutline.ts
  var PRIMITIVE_TRACK_KEYS = [...PRIMITIVE_PROPERTIES, "cornerRadius"];

  // ../engine/src/textPath.ts
  function resolveTextPath(project, textObj, time) {
    const tp = textObj.textPath;
    if (!tp) return null;
    const target = project.objects.find((o) => o.id === tp.pathObjectId);
    if (!target) return null;
    if (target.boolean) return null;
    const asset = project.assets.find((a) => a.id === target.assetId);
    if (!asset || asset.kind !== "vector" || asset.shapeType !== "path") return null;
    const state = sampleObject(target, time, asset.primitive);
    const path = state.path ?? asset.path;
    if (!path || path.nodes.length === 0) return null;
    const box = pathBounds(path);
    const { anchorX, anchorY } = resolveAnchor(target, state, "path", box);
    const chain = worldChain(project, target, anchorX, anchorY, time);
    const worldPath = { nodes: path.nodes.map((n) => worldTransformNode(chain, n)), closed: path.closed };
    const worldD = pathToD(worldPath);
    const offsetTrack = textObj.tracks.textPathOffset;
    const startOffset = offsetTrack && offsetTrack.length > 0 ? interpolate(offsetTrack, time) : tp.startOffset;
    return { worldD, startOffset };
  }

  // ../engine/src/repeat.ts
  function normalizeRepeat(r) {
    const { count, dx, dy, rotate: rotate2, scale, stagger } = r;
    if (![count, dx, dy, rotate2, scale, stagger].every(Number.isFinite)) return void 0;
    if (count <= 1) return void 0;
    return {
      count: Math.min(64, Math.max(2, Math.round(count))),
      dx,
      dy,
      rotate: rotate2,
      scale: Math.min(100, Math.max(0.01, scale)),
      stagger: Math.max(0, stagger)
    };
  }
  function repeatDeltaTransform(r, k) {
    if (k === 0) return "";
    const dx = r.dx * k;
    const dy = r.dy * k;
    const rotate2 = r.rotate * k;
    const scale = Math.pow(r.scale, k);
    const parts = [];
    if (dx !== 0 || dy !== 0) parts.push(`translate(${fmt(dx)}, ${fmt(dy)})`);
    if (rotate2 !== 0) parts.push(`rotate(${fmt(rotate2)})`);
    if (scale !== 1) parts.push(`scale(${fmt(scale)})`);
    return parts.join(" ");
  }

  // ../engine/src/scenes.ts
  var ROOT_SCENE_ID = "scene-root";
  function projectScenes(project) {
    if (project.scenes) return project.scenes;
    return [
      {
        id: ROOT_SCENE_ID,
        name: "Scene 1",
        objects: project.objects,
        camera: project.camera,
        duration: computeProjectDuration(project)
      }
    ];
  }
  function transitionOverlap(scene, prevScene) {
    const t = scene.transitionIn;
    if (!t || t.kind === "cut") return 0;
    return Math.max(0, Math.min(t.duration, prevScene.duration, scene.duration));
  }
  function resolveTimeline(project) {
    const scenes = projectScenes(project);
    const spans = [];
    let cursor = 0;
    scenes.forEach((scene, index) => {
      const overlap = index > 0 ? transitionOverlap(scene, scenes[index - 1]) : 0;
      const start = cursor - overlap;
      const end = start + scene.duration;
      spans.push({ scene, index, start, end });
      cursor = end;
    });
    return spans;
  }
  function sceneAtTime(project, t) {
    const spans = resolveTimeline(project);
    if (spans.length === 0) {
      return { primary: { scene: { id: ROOT_SCENE_ID, name: "Scene 1", objects: [], duration: 0 }, localTime: 0 } };
    }
    let pi = 0;
    for (let i = 0; i < spans.length; i++) {
      if (spans[i].start <= t) pi = i;
      else break;
    }
    const primarySpan = spans[pi];
    const localTime = Math.min(Math.max(0, t - primarySpan.start), primarySpan.scene.duration);
    const sample = { primary: { scene: primarySpan.scene, localTime } };
    if (pi > 0) {
      const overlap = transitionOverlap(primarySpan.scene, spans[pi - 1].scene);
      if (overlap > 0 && t < primarySpan.start + overlap) {
        const prev = spans[pi - 1];
        sample.outgoing = {
          scene: prev.scene,
          localTime: Math.min(Math.max(0, t - prev.start), prev.scene.duration),
          progress: (t - primarySpan.start) / overlap
          // 0 at overlap start → 1 at overlap end
        };
      }
    }
    return sample;
  }
  function computeProjectDurationMulti(project) {
    const spans = resolveTimeline(project);
    let max = spans.length ? spans[spans.length - 1].end : 0;
    for (const clip of project.audioClips) {
      const end = clip.startTime + (clip.outPoint - clip.inPoint);
      if (end > max) max = end;
    }
    return max;
  }

  // ../engine/src/duration.ts
  function objectsMaxKeyframeTime(objects) {
    let max = 0;
    for (const obj of objects) {
      let objMax = 0;
      for (const track of Object.values(obj.tracks)) {
        if (!track) continue;
        for (const keyframe of track) if (keyframe.time > objMax) objMax = keyframe.time;
      }
      for (const keyframe of obj.shapeTrack ?? []) if (keyframe.time > objMax) objMax = keyframe.time;
      for (const track of Object.values(obj.colorTracks ?? {})) {
        for (const keyframe of track ?? []) if (keyframe.time > objMax) objMax = keyframe.time;
      }
      for (const track of Object.values(obj.gradientTracks ?? {})) {
        for (const keyframe of track ?? []) if (keyframe.time > objMax) objMax = keyframe.time;
      }
      for (const keyframe of obj.dashOffsetTrack ?? []) if (keyframe.time > objMax) objMax = keyframe.time;
      for (const track of [obj.trim?.startTrack, obj.trim?.endTrack, obj.trim?.offsetTrack]) {
        for (const keyframe of track ?? []) if (keyframe.time > objMax) objMax = keyframe.time;
      }
      for (const keyframe of obj.motionPath?.progress ?? []) if (keyframe.time > objMax) objMax = keyframe.time;
      if (objMax > 0 && obj.repeat) {
        const repeat = normalizeRepeat(obj.repeat);
        if (repeat) objMax += repeat.stagger * (repeat.count - 1);
      }
      if (objMax > max) max = objMax;
    }
    return max;
  }
  function symbolEffectiveDuration(asset) {
    return asset.duration > 0 ? asset.duration : objectsMaxKeyframeTime(asset.objects);
  }
  function instanceTimelineEnd(obj, assetsById) {
    const asset = assetsById.get(obj.assetId);
    if (!asset || asset.kind !== "symbol") return 0;
    if (obj.symbolTimeTrack && obj.symbolTimeTrack.length > 0) {
      return obj.symbolTimeTrack[obj.symbolTimeTrack.length - 1].time;
    }
    const internal = symbolEffectiveDuration(asset);
    if (internal <= 0) return 0;
    const t = obj.symbolTime;
    const speed = t && t.speed > 0 ? t.speed : 1;
    const startOffset = t?.startOffset ?? 0;
    const cycle = t?.pingPong ? 2 * internal : internal;
    const active = !t?.loop ? internal : t.playCount && t.playCount > 0 ? t.playCount * cycle : cycle;
    return startOffset + active / speed;
  }
  function computeProjectDuration(project) {
    if (project.scenes) return computeProjectDurationMulti(project);
    if (project.meta.durationMode === "manual") {
      return project.meta.duration;
    }
    let max = objectsMaxKeyframeTime(project.objects);
    const byId = new Map(project.assets.map((a) => [a.id, a]));
    for (const obj of project.objects) {
      const end = instanceTimelineEnd(obj, byId);
      if (end > max) max = end;
    }
    for (const clip of project.audioClips) {
      const end = clip.startTime + (clip.outPoint - clip.inPoint);
      if (end > max) max = end;
    }
    return max;
  }

  // ../engine/src/symbol.ts
  function remapLocalTime(parentTime, timing, symbolDuration) {
    const t = (parentTime - timing.startOffset) * timing.speed + (timing.phase ?? 0);
    if (t <= 0) return 0;
    if (symbolDuration <= 0) return 0;
    if (!timing.loop) return Math.min(t, symbolDuration);
    if (timing.playCount && timing.playCount > 0) {
      const cycle = timing.pingPong ? 2 * symbolDuration : symbolDuration;
      if (t >= timing.playCount * cycle) return timing.pingPong ? 0 : symbolDuration;
    }
    if (timing.pingPong) {
      const m = t % (2 * symbolDuration);
      return m <= symbolDuration ? m : 2 * symbolDuration - m;
    }
    return t % symbolDuration;
  }
  function flattenInstances(project, time) {
    const assetsById = new Map(project.assets.map((a) => [a.id, a]));
    const leaves = [];
    const consumed = /* @__PURE__ */ new Set();
    const rootById = new Map(project.objects.map((o) => [o.id, o]));
    for (const o of project.objects) {
      for (const id of o.boolean?.operandIds ?? []) {
        consumed.add(id);
        if (rootById.get(id)?.isGroup) {
          for (const d of groupDescendantIds(project.objects, id)) consumed.add(d);
        }
      }
    }
    const walk2 = (objects, localTime, basePrefix, idPrefix, opacity, visited, clipCtx, tintCtx) => {
      const objectsById = new Map(objects.map((o) => [o.id, o]));
      const ordered = objects.map((o, i) => ({ o, i })).sort((a, b) => a.o.zOrder - b.o.zOrder || a.i - b.i);
      for (const { o } of ordered) {
        if (o.isGroup) continue;
        if (isRenderHidden(o, objectsById)) continue;
        if (consumed.has(o.id)) continue;
        const groupPrefix = groupTransformPrefix(objects, o, localTime);
        const fullPrefix = [basePrefix, groupPrefix].filter(Boolean).join(" ");
        const renderId = idPrefix ? `${idPrefix}/${o.id}` : o.id;
        const asset = assetsById.get(o.assetId);
        if (asset && asset.kind === "symbol") {
          if (visited.has(asset.id)) continue;
          const st = sampleObject(o, localTime);
          const instTransform = [fullPrefix, buildTransform(st, o.anchorX, o.anchorY)].filter(Boolean).join(" ");
          const nextVisited = new Set(visited);
          nextVisited.add(asset.id);
          const childTime = o.freezeFirstFrame ? 0 : o.symbolTimeTrack && o.symbolTimeTrack.length > 0 ? Math.max(0, interpolate(o.symbolTimeTrack, localTime)) : o.symbolTime ? remapLocalTime(localTime, o.symbolTime, symbolEffectiveDuration(asset)) : localTime;
          const nextClipCtx = asset.clip && !clipCtx ? { clipId: `clip-${renderId}`, clipTransform: instTransform, clipWidth: asset.width, clipHeight: asset.height } : clipCtx;
          const nextTintCtx = o.tint ? { tintId: `savig-tint-${renderId}`, tintColor: o.tint.color, tintAmount: o.tint.amount } : tintCtx;
          walk2(asset.objects, childTime, instTransform, renderId, opacity * st.opacity, nextVisited, nextClipCtx, nextTintCtx);
        } else {
          const repeat = o.repeat ? normalizeRepeat(o.repeat) : void 0;
          const copies = repeat ? repeat.count : 1;
          for (let k = 0; k < copies; k++) {
            const delta = repeat ? repeatDeltaTransform(repeat, k) : "";
            leaves.push({
              renderId: k === 0 ? renderId : `${renderId}@${k}`,
              object: o,
              transformPrefix: delta ? fullPrefix ? `${fullPrefix} ${delta}` : delta : fullPrefix,
              opacityFactor: opacity,
              localTime: repeat && k > 0 ? Math.max(0, localTime - k * repeat.stagger) : localTime,
              ...clipCtx ? {
                clipId: clipCtx.clipId,
                clipTransform: clipCtx.clipTransform,
                clipWidth: clipCtx.clipWidth,
                clipHeight: clipCtx.clipHeight
              } : {},
              ...tintCtx ? {
                tintId: tintCtx.tintId,
                tintColor: tintCtx.tintColor,
                tintAmount: tintCtx.tintAmount
              } : {}
            });
          }
        }
      }
    };
    walk2(project.objects, time, "", "", 1, /* @__PURE__ */ new Set());
    return leaves;
  }

  // ../engine/src/clock.ts
  function createClock() {
    return { time: 0, playing: false, lastTimestamp: null };
  }
  function play(state, timestamp) {
    return { ...state, playing: true, lastTimestamp: timestamp };
  }
  function pause(state) {
    return { ...state, playing: false, lastTimestamp: null };
  }
  function seek(state, time) {
    return { ...state, time: Math.max(0, time), lastTimestamp: null };
  }
  function advance(state, timestamp, duration, loop) {
    if (!state.playing) return state;
    if (state.lastTimestamp === null) {
      return { ...state, lastTimestamp: timestamp };
    }
    const delta = timestamp - state.lastTimestamp;
    let time = state.time + delta;
    if (duration <= 0) {
      return { ...state, time: 0, lastTimestamp: timestamp };
    }
    if (time >= duration) {
      if (loop) {
        time = time % duration;
        return { ...state, time, lastTimestamp: timestamp };
      }
      return { ...state, time: duration, playing: false, lastTimestamp: null };
    }
    return { ...state, time, lastTimestamp: timestamp };
  }

  // ../engine/src/audio-timing.ts
  function resolveActiveClips(clips, time) {
    const active = [];
    for (const clip of clips) {
      const clipDuration = clip.outPoint - clip.inPoint;
      const end = clip.startTime + clipDuration;
      if (time >= clip.startTime && time < end) {
        active.push({ clip, sourceOffset: clip.inPoint + (time - clip.startTime) });
      }
    }
    return active;
  }

  // ../engine/src/camera.ts
  function sampleCamera(camera, time) {
    const axis = (a) => {
      const track = camera.tracks[a];
      if (track && track.length > 0) return interpolate(track, time, a === "rotation");
      return camera.base[a];
    };
    return { x: axis("x"), y: axis("y"), zoom: axis("zoom"), rotation: axis("rotation") };
  }
  function cameraTransform(pose, width, height) {
    return `translate(${fmt(width / 2)} ${fmt(height / 2)}) scale(${fmt(pose.zoom)}) rotate(${fmt(pose.rotation)}) translate(${fmt(-pose.x)} ${fmt(-pose.y)})`;
  }
  function computeSceneCameraTransform(camera, width, height, time) {
    if (!camera) return null;
    return cameraTransform(sampleCamera(camera, time), width, height);
  }
  function computeCameraTransform(project, time) {
    return computeSceneCameraTransform(project.camera, project.meta.width, project.meta.height, time);
  }

  // ../engine/src/audio-mix.ts
  var DEFAULT_STATE = { audible: true, gain: 1, pan: 0 };
  function resolveTrackState(tracks, trackId) {
    const anySolo = (tracks ?? []).some((t) => t.solo);
    const track = trackId ? tracks?.find((t) => t.id === trackId) : void 0;
    if (!track) return anySolo ? { ...DEFAULT_STATE, audible: false } : DEFAULT_STATE;
    const audible = !track.muted && (!anySolo || track.solo);
    return {
      audible,
      gain: track.gain,
      pan: track.pan ?? 0,
      ...track.filter ? { filter: track.filter } : {}
    };
  }
  function clipFadeGainAt(clip, timelineTime) {
    const len = clip.outPoint - clip.inPoint;
    const end = clip.startTime + len;
    if (timelineTime < clip.startTime || timelineTime >= end || len <= 0) return 0;
    const fadeIn = Math.min(clip.fadeIn ?? 0, len);
    const fadeOut = Math.min(clip.fadeOut ?? 0, len);
    const inRamp = fadeIn > 0 ? Math.min(1, (timelineTime - clip.startTime) / fadeIn) : 1;
    const outRamp = fadeOut > 0 ? Math.min(1, (end - timelineTime) / fadeOut) : 1;
    return Math.min(inRamp, outRamp);
  }
  function fadeEnvelopePoints(clip, fromTime) {
    const len = clip.outPoint - clip.inPoint;
    const end = clip.startTime + len;
    const start = Math.max(clip.startTime, fromTime);
    if (end <= start || len <= 0) return [];
    const fadeIn = Math.min(clip.fadeIn ?? 0, len);
    const fadeOut = Math.min(clip.fadeOut ?? 0, len);
    const gainAt = (t) => {
      if (t < end) return clipFadeGainAt(clip, t);
      return fadeOut > 0 ? 0 : clipFadeGainAt(clip, Math.max(start, end - Math.min(1e-9, len)));
    };
    const breakpoints = [start, clip.startTime + fadeIn, end - fadeOut, end].filter((t, i, a) => t >= start && t <= end && a.indexOf(t) === i).sort((a, b) => a - b);
    return breakpoints.map((t) => ({ t, gain: gainAt(t) }));
  }

  // ../engine/src/script/tokenize.ts
  var OPS = ["&&", "||", "==", "!=", "<=", ">=", "+", "-", "*", "/", "%", "<", ">", "!"];
  var ESCAPES = { "\\": "\\", "'": "'", '"': '"', n: "\n", t: "	" };
  function tokenize(source) {
    if (source.length > 500) {
      return { ok: false, message: "expression longer than 500 characters", pos: 500 };
    }
    const tokens = [];
    let i = 0;
    while (i < source.length) {
      const c = source[i];
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (/[0-9]/.test(c) || c === "." && /[0-9]/.test(source[i + 1] ?? "")) {
        const start = i;
        while (i < source.length && /[0-9.]/.test(source[i])) {
          i++;
        }
        const text = source.slice(start, i);
        const value = Number(text);
        if (!Number.isFinite(value)) {
          return { ok: false, message: `bad number "${text}"`, pos: start };
        }
        tokens.push({ kind: "num", text, value, pos: start });
        continue;
      }
      if (c === "'" || c === '"') {
        const quote = c;
        const start = i;
        let out = "";
        i++;
        while (i < source.length && source[i] !== quote) {
          if (source[i] === "\\") {
            const esc = ESCAPES[source[i + 1]];
            if (esc === void 0) {
              return { ok: false, message: `unknown escape "\\${source[i + 1] ?? ""}"`, pos: i };
            }
            out += esc;
            i += 2;
          } else {
            out += source[i];
            i++;
          }
        }
        if (i >= source.length) {
          return { ok: false, message: "unterminated string", pos: start };
        }
        i++;
        tokens.push({ kind: "str", text: out, value: out, pos: start });
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const start = i;
        while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) {
          i++;
        }
        tokens.push({ kind: "ident", text: source.slice(start, i), pos: start });
        continue;
      }
      if (c === "(") {
        tokens.push({ kind: "lparen", text: c, pos: i++ });
        continue;
      }
      if (c === ")") {
        tokens.push({ kind: "rparen", text: c, pos: i++ });
        continue;
      }
      if (c === "?") {
        tokens.push({ kind: "question", text: c, pos: i++ });
        continue;
      }
      if (c === ":") {
        tokens.push({ kind: "colon", text: c, pos: i++ });
        continue;
      }
      const op = OPS.find((o) => source.startsWith(o, i));
      if (op) {
        tokens.push({ kind: "op", text: op, pos: i });
        i += op.length;
        continue;
      }
      return { ok: false, message: `unexpected character "${c}"`, pos: i };
    }
    tokens.push({ kind: "eof", text: "", pos: source.length });
    return { ok: true, tokens };
  }

  // ../engine/src/script/parse.ts
  var BIN_PRECEDENCE = {
    "||": 1,
    "&&": 2,
    "==": 3,
    "!=": 3,
    "<": 4,
    "<=": 4,
    ">": 4,
    ">=": 4,
    "+": 5,
    "-": 5,
    "*": 6,
    "/": 6,
    "%": 6
  };
  var MAX_DEPTH = 32;
  function current(p) {
    return p.tokens[p.pos] ?? { kind: "eof", text: "", pos: -1 };
  }
  function advance2(p) {
    p.pos++;
  }
  function parseExpr(p, minPrec, depth) {
    if (depth > MAX_DEPTH) {
      return null;
    }
    let left = parsePrimary(p, depth);
    if (!left) return null;
    let leftDepth = depth;
    while (true) {
      const tok = current(p);
      if (tok.kind !== "op") break;
      const prec = BIN_PRECEDENCE[tok.text];
      if (prec === void 0 || prec < minPrec) break;
      leftDepth++;
      if (leftDepth > MAX_DEPTH) {
        return null;
      }
      const op = tok.text;
      const opPos = tok.pos;
      advance2(p);
      const right = parseExpr(p, prec + 1, leftDepth + 1);
      if (!right) return null;
      left = { kind: "binary", op, left, right, pos: opPos };
    }
    if (minPrec === 0 && current(p).kind === "question") {
      const qPos = current(p).pos;
      advance2(p);
      const then = parseExpr(p, 0, depth + 1);
      if (!then) return null;
      if (current(p).kind !== "colon") {
        return null;
      }
      advance2(p);
      const els = parseExpr(p, 0, depth + 1);
      if (!els) return null;
      const pos = left.kind === "lit" ? qPos : left.pos;
      return { kind: "ternary", cond: left, then, else: els, pos };
    }
    return left;
  }
  function measureASTDepth(expr) {
    const stack = [{ node: expr, depth: 1 }];
    let maxDepth = 1;
    while (stack.length > 0) {
      const { node, depth } = stack.pop();
      maxDepth = Math.max(maxDepth, depth);
      switch (node.kind) {
        case "lit":
        case "var":
        case "call":
          break;
        case "unary":
          stack.push({ node: node.expr, depth: depth + 1 });
          break;
        case "binary":
          stack.push({ node: node.left, depth: depth + 1 });
          stack.push({ node: node.right, depth: depth + 1 });
          break;
        case "ternary":
          stack.push({ node: node.cond, depth: depth + 1 });
          stack.push({ node: node.then, depth: depth + 1 });
          stack.push({ node: node.else, depth: depth + 1 });
          break;
      }
    }
    return maxDepth;
  }
  function parsePrimary(p, depth) {
    if (depth > MAX_DEPTH) {
      return null;
    }
    const tok = current(p);
    if (tok.kind === "num") {
      advance2(p);
      return { kind: "lit", value: tok.value };
    }
    if (tok.kind === "str") {
      advance2(p);
      return { kind: "lit", value: tok.value };
    }
    if (tok.kind === "ident") {
      if (tok.text === "true") {
        advance2(p);
        return { kind: "lit", value: true };
      }
      if (tok.text === "false") {
        advance2(p);
        return { kind: "lit", value: false };
      }
      const name = tok.text;
      const namePos = tok.pos;
      advance2(p);
      if (current(p).kind === "lparen") {
        if (name !== "random") {
          return null;
        }
        advance2(p);
        if (current(p).kind !== "rparen") {
          return null;
        }
        advance2(p);
        return { kind: "call", name: "random", pos: namePos };
      }
      return { kind: "var", name, pos: namePos };
    }
    if (tok.kind === "lparen") {
      advance2(p);
      const expr = parseExpr(p, 0, depth + 1);
      if (!expr) return null;
      if (current(p).kind !== "rparen") {
        return null;
      }
      advance2(p);
      return expr;
    }
    if (tok.kind === "op" && (tok.text === "-" || tok.text === "!")) {
      const op = tok.text;
      const opPos = tok.pos;
      advance2(p);
      const expr = parsePrimary(p, depth + 1);
      if (!expr) return null;
      return { kind: "unary", op, expr, pos: opPos };
    }
    return null;
  }
  function parse(source) {
    const tokenResult = tokenize(source);
    if (!tokenResult.ok) {
      return tokenResult;
    }
    const p = { tokens: tokenResult.tokens, pos: 0 };
    const expr = parseExpr(p, 0, 0);
    if (!expr) {
      const tok = current(p);
      return { ok: false, message: "parse error", pos: tok.pos };
    }
    const trailing = current(p);
    if (trailing.kind !== "eof") {
      return { ok: false, message: "unexpected trailing tokens", pos: trailing.pos };
    }
    if (measureASTDepth(expr) > MAX_DEPTH) {
      return { ok: false, message: "expression too deeply nested", pos: 0 };
    }
    return { ok: true, ast: expr };
  }

  // ../engine/src/script/evaluate.ts
  function evaluate(ast, env) {
    try {
      return { ok: true, value: evalNode(ast, env) };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }
  function evalNode(n, env) {
    switch (n.kind) {
      case "lit":
        return n.value;
      case "var": {
        if (n.name === "time") return env.time;
        if (n.name === "sceneIndex") return env.sceneIndex;
        if (n.name === "sceneTime") return env.sceneTime;
        const v = env.vars.get(n.name);
        if (v === void 0) throw new Error(`unknown variable "${n.name}"`);
        return v;
      }
      case "call":
        return env.random();
      case "unary": {
        const v = evalNode(n.expr, env);
        if (n.op === "-") {
          if (typeof v !== "number") throw new Error("unary - needs a number");
          return -v;
        }
        if (typeof v !== "boolean") throw new Error("! needs a boolean");
        return !v;
      }
      case "binary": {
        if (n.op === "&&" || n.op === "||") {
          const l2 = evalNode(n.left, env);
          if (typeof l2 !== "boolean") throw new Error(`${n.op} needs booleans`);
          if (n.op === "&&" && !l2) return false;
          if (n.op === "||" && l2) return true;
          const r2 = evalNode(n.right, env);
          if (typeof r2 !== "boolean") throw new Error(`${n.op} needs booleans`);
          return r2;
        }
        const l = evalNode(n.left, env);
        const r = evalNode(n.right, env);
        switch (n.op) {
          case "+": {
            if (typeof l === "string" || typeof r === "string") {
              if (typeof l === "boolean" || typeof r === "boolean") {
                throw new Error("+ cannot mix booleans");
              }
              return String(l) + String(r);
            }
            if (typeof l !== "number" || typeof r !== "number") {
              throw new Error("+ cannot mix booleans");
            }
            return l + r;
          }
          case "-":
          case "*":
          case "/":
          case "%": {
            if (typeof l !== "number" || typeof r !== "number") {
              throw new Error(`${n.op} needs numbers`);
            }
            if ((n.op === "/" || n.op === "%") && r === 0) {
              throw new Error("division by zero");
            }
            if (n.op === "-") return l - r;
            if (n.op === "*") return l * r;
            if (n.op === "/") return l / r;
            return l % r;
          }
          case "==":
            return typeof l === typeof r ? l === r : false;
          case "!=":
            return typeof l === typeof r ? l !== r : true;
          case "<":
          case "<=":
          case ">":
          case ">=": {
            if (typeof l !== "number" || typeof r !== "number") {
              throw new Error(`${n.op} needs numbers`);
            }
            if (n.op === "<") return l < r;
            if (n.op === "<=") return l <= r;
            if (n.op === ">") return l > r;
            return l >= r;
          }
          default:
            throw new Error(`unknown operator: ${n.op}`);
        }
      }
      case "ternary": {
        const c = evalNode(n.cond, env);
        if (typeof c !== "boolean") throw new Error("?: condition needs a boolean");
        return evalNode(c ? n.then : n.else, env);
      }
    }
  }

  // ../engine/src/script/session.ts
  var CASCADE_LIMIT = 8;
  function createSession(project, host) {
    const objectBehaviors = /* @__PURE__ */ new Map();
    for (const scene of projectScenes(project)) {
      for (const o of scene.objects) {
        if (o.behaviors && o.behaviors.length > 0) objectBehaviors.set(o.id, o.behaviors);
      }
    }
    const globalHandlers = project.interactions?.handlers ?? [];
    const declaredInitials = /* @__PURE__ */ new Map();
    for (const v of project.interactions?.variables ?? []) declaredInitials.set(v.name, v.initial);
    const vars = new Map(declaredInitials);
    const overrides = /* @__PURE__ */ new Map();
    let hoverChain = [];
    let lastSceneId = null;
    let processing = false;
    let pendingTime = null;
    let changed = false;
    const listeners = /* @__PURE__ */ new Set();
    const warnedMessages = /* @__PURE__ */ new Set();
    const parseCache = /* @__PURE__ */ new Map();
    function getAst(src) {
      let r = parseCache.get(src);
      if (!r) {
        r = parse(src);
        parseCache.set(src, r);
      }
      return r;
    }
    function warnOnce(message) {
      if (warnedMessages.has(message)) return;
      warnedMessages.add(message);
      host.warn(message);
    }
    function env() {
      const t = host.now();
      const sample = sceneAtTime(project, t);
      const spans = resolveTimeline(project);
      const index = spans.findIndex((s) => s.scene.id === sample.primary.scene.id);
      return {
        vars,
        time: t,
        sceneIndex: index < 0 ? 0 : index,
        sceneTime: sample.primary.localTime,
        random: host.random
      };
    }
    function evalArg(src) {
      const parsed = getAst(src);
      if (!parsed.ok) {
        warnOnce(parsed.message);
        return null;
      }
      const result = evaluate(parsed.ast, env());
      if (!result.ok) {
        warnOnce(result.message);
        return null;
      }
      return result.value;
    }
    function evalGuard(src) {
      return evalArg(src) === true;
    }
    function findObject(id) {
      for (const scene of projectScenes(project)) {
        const o = scene.objects.find((x) => x.id === id);
        if (o) return o;
      }
      return void 0;
    }
    function isTextObject(id) {
      const obj = findObject(id);
      if (!obj) return false;
      const asset = project.assets.find((a) => a.id === obj.assetId);
      return asset?.kind === "text";
    }
    function setOverride(id, patch) {
      const prev = overrides.get(id) ?? {};
      overrides.set(id, { ...prev, ...patch });
      changed = true;
    }
    function seekAndRecord(t) {
      host.seek(t);
      pendingTime = t;
    }
    function runAction(action, ownerObjectId) {
      const targetId = action.args?.targetId ?? ownerObjectId ?? void 0;
      switch (action.kind) {
        case "play":
          host.play();
          return;
        case "pause":
          host.pause();
          return;
        case "stop":
          host.pause();
          seekAndRecord(0);
          return;
        case "seek": {
          const raw = action.args?.time;
          if (raw === void 0) return;
          const v = evalArg(raw);
          if (typeof v !== "number") return;
          seekAndRecord(Math.max(0, v));
          return;
        }
        case "gotoScene": {
          const sceneId = action.args?.sceneId;
          if (!sceneId) return;
          const span = resolveTimeline(project).find((s) => s.scene.id === sceneId);
          if (!span) return;
          seekAndRecord(span.start);
          return;
        }
        case "setVar": {
          const name = action.args?.name;
          const raw = action.args?.value;
          if (!name || raw === void 0) return;
          const v = evalArg(raw);
          if (v === null) return;
          vars.set(name, v);
          changed = true;
          return;
        }
        case "show":
        case "hide": {
          if (!targetId) return;
          setOverride(targetId, { hidden: action.kind === "hide" });
          return;
        }
        case "setOpacity": {
          if (!targetId) return;
          const raw = action.args?.value;
          if (raw === void 0) return;
          const v = evalArg(raw);
          if (typeof v !== "number") return;
          setOverride(targetId, { opacity: Math.min(1, Math.max(0, v)) });
          return;
        }
        case "setPosition": {
          if (!targetId) return;
          const patch = {};
          const dxSrc = action.args?.dx;
          const dySrc = action.args?.dy;
          if (dxSrc !== void 0) {
            const v = evalArg(dxSrc);
            if (typeof v !== "number") return;
            patch.dx = v;
          }
          if (dySrc !== void 0) {
            const v = evalArg(dySrc);
            if (typeof v !== "number") return;
            patch.dy = v;
          }
          if (Object.keys(patch).length === 0) return;
          setOverride(targetId, patch);
          return;
        }
        case "setText": {
          if (!targetId) return;
          if (!isTextObject(targetId)) return;
          const raw = action.args?.value;
          if (raw === void 0) return;
          const v = evalArg(raw);
          if (v === null) return;
          setOverride(targetId, { text: typeof v === "string" ? v : String(v) });
          return;
        }
      }
    }
    function runActions(behavior, ownerObjectId) {
      for (const action of behavior.actions) {
        if (action.if !== void 0 && !evalGuard(action.if)) continue;
        runAction(action, ownerObjectId);
      }
    }
    function fireForOwner(ownerId, kind) {
      const behaviors = objectBehaviors.get(ownerId) ?? [];
      for (const b of behaviors) {
        if (b.event === kind) runActions(b, ownerId);
      }
    }
    function fireSceneEvent(event, sceneId) {
      for (const b of globalHandlers) {
        if (b.event === event && (b.sceneId === void 0 || b.sceneId === sceneId)) {
          runActions(b, null);
        }
      }
    }
    function fireGlobal(event) {
      for (const b of globalHandlers) {
        if (b.event === event) runActions(b, null);
      }
    }
    function emitSceneChange(t) {
      const id = sceneAtTime(project, t).primary.scene.id;
      if (id !== lastSceneId) {
        if (lastSceneId !== null) fireSceneEvent("sceneEnd", lastSceneId);
        fireSceneEvent("sceneStart", id);
        lastSceneId = id;
      }
    }
    function diffHover(chain) {
      const next = chain ?? [];
      const prevSet = new Set(hoverChain);
      const nextSet = new Set(next);
      for (const id of hoverChain) {
        if (!nextSet.has(id)) fireForOwner(id, "hoverLeave");
      }
      for (const id of next) {
        if (!prevSet.has(id)) fireForOwner(id, "hoverEnter");
      }
      hoverChain = next;
    }
    function notify() {
      for (const cb of listeners) cb();
    }
    function withProcessing(fn, reentrantTime) {
      if (processing) {
        if (reentrantTime !== void 0) pendingTime = reentrantTime;
        return;
      }
      processing = true;
      changed = false;
      try {
        fn();
        let hops = 0;
        while (pendingTime !== null && hops < CASCADE_LIMIT) {
          const t = pendingTime;
          pendingTime = null;
          hops++;
          emitSceneChange(t);
        }
        if (pendingTime !== null) {
          host.warn(`interaction: cascade limit (${CASCADE_LIMIT}) exceeded; stopping`);
          pendingTime = null;
        }
      } finally {
        processing = false;
      }
      if (changed) notify();
    }
    function firePointer(kind, chain) {
      withProcessing(() => {
        for (const id of chain) fireForOwner(id, kind);
      });
    }
    function fireKey(kind, key) {
      withProcessing(() => {
        for (const b of globalHandlers) {
          if (b.event === kind && b.key === key) runActions(b, null);
        }
      });
    }
    function pointerAt(chain) {
      withProcessing(() => diffHover(chain));
    }
    function tickTo(masterTime, playing) {
      withProcessing(() => {
        emitSceneChange(masterTime);
        if (playing) fireGlobal("tick");
      }, masterTime);
    }
    function reset() {
      vars.clear();
      for (const [k, v] of declaredInitials) vars.set(k, v);
      overrides.clear();
      hoverChain = [];
      lastSceneId = null;
      notify();
      withProcessing(() => emitSceneChange(host.now()));
    }
    withProcessing(() => emitSceneChange(host.now()));
    return {
      firePointer,
      fireKey,
      pointerAt,
      tickTo,
      overrides: () => overrides,
      vars: () => vars,
      onChange: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      reset
    };
  }

  // ../engine/src/script/resolve.ts
  var REPEATER_SUFFIX = /@\d+$/;
  function findContainingScene(project, topLevelId) {
    for (const scene of projectScenes(project)) {
      if (scene.objects.some((o) => o.id === topLevelId)) return scene;
    }
    return null;
  }
  function splitScenePrefix(project, renderId) {
    const colon = renderId.indexOf(":");
    if (colon === -1) return { sceneId: null, rest: renderId };
    const candidate = renderId.slice(0, colon);
    const knownSceneIds = projectScenes(project).map((s) => s.id);
    if (!knownSceneIds.includes(candidate)) return { sceneId: null, rest: renderId };
    return { sceneId: candidate, rest: renderId.slice(colon + 1) };
  }
  function resolveAuthoredChain(project, renderId) {
    const { sceneId, rest } = splitScenePrefix(project, renderId);
    const stripped = rest.replace(REPEATER_SUFFIX, "");
    const slash = stripped.indexOf("/");
    const topLevelId = slash === -1 ? stripped : stripped.slice(0, slash);
    const scene = sceneId ? projectScenes(project).find((s) => s.id === sceneId) ?? null : findContainingScene(project, topLevelId);
    if (!scene) return [];
    const byId = new Map(scene.objects.map((o) => [o.id, o]));
    const chain = [topLevelId];
    const seen = /* @__PURE__ */ new Set([topLevelId]);
    let pid = byId.get(topLevelId)?.parentId;
    while (pid && !seen.has(pid)) {
      const parent = byId.get(pid);
      if (!parent?.isGroup) break;
      chain.push(pid);
      seen.add(pid);
      pid = parent.parentId;
    }
    return chain;
  }
  function expandOverrides(project, overrides, renderIds) {
    const result = /* @__PURE__ */ new Map();
    for (const renderId of renderIds) {
      const chain = resolveAuthoredChain(project, renderId);
      let merged;
      for (let i = chain.length - 1; i >= 0; i--) {
        const ov = overrides.get(chain[i]);
        if (ov) merged = { ...merged ?? {}, ...ov };
      }
      if (merged) result.set(renderId, merged);
    }
    return result;
  }

  // src/frame.ts
  function computeFrame(project, time) {
    if (!project.scenes) return computeFrameForScene(project, time, null);
    const { primary, outgoing } = sceneAtTime(project, time);
    const view = (scene) => ({ ...project, objects: scene.objects, scenes: void 0 });
    const items = computeFrameForScene(view(primary.scene), primary.localTime, primary.scene.id);
    if (outgoing) items.push(...computeFrameForScene(view(outgoing.scene), outgoing.localTime, outgoing.scene.id));
    return items;
  }
  function computeFrameForScene(sceneProject, localTime, sceneId) {
    const assetsById = new Map(sceneProject.assets.map((a) => [a.id, a]));
    return flattenInstances(sceneProject, localTime).map((leaf) => {
      const obj = leaf.object;
      const asset = assetsById.get(obj.assetId);
      const state = sampleObject(obj, leaf.localTime, asset?.kind === "vector" ? asset.primitive : void 0);
      const shapeType = asset && asset.kind === "vector" ? asset.shapeType : void 0;
      const pathBox = asset && asset.kind === "vector" && asset.shapeType === "path" ? pathBounds(state.path ?? asset.path ?? { nodes: [], closed: false }) : void 0;
      const { anchorX, anchorY } = resolveAnchor(obj, state, shapeType, pathBox);
      const resolvedTextPath = asset?.kind === "text" && obj.textPath ? resolveTextPath(sceneProject, obj, leaf.localTime) : null;
      const item = {
        objectId: sceneId ? `${sceneId}:${leaf.renderId}` : leaf.renderId,
        transform: resolvedTextPath ? "" : (leaf.transformPrefix ? leaf.transformPrefix + " " : "") + buildTransform(state, anchorX, anchorY),
        opacity: fmt(state.opacity * leaf.opacityFactor)
      };
      if (resolvedTextPath) {
        item.textPathD = resolvedTextPath.worldD;
        item.textPathStartOffset = fmt(resolvedTextPath.startOffset);
      }
      if (shapeType && shapeType !== "path" && state.geometry) {
        item.geometry = geometryToSvgAttrs(shapeType, state.geometry);
      }
      if (obj.boolean) {
        const rings = resolveBooleanRings(sceneProject, obj, leaf.localTime);
        item.pathD = rings.length > 0 ? pathToDRings(rings[0], rings.slice(1)) : "";
      } else if (state.path) {
        item.pathD = pathToD(state.path);
      }
      const hasFillGradient = asset?.kind === "vector" && !!asset.style.fillGradient || state.fillGradient !== void 0;
      const hasStrokeGradient = asset?.kind === "vector" && !!asset.style.strokeGradient || state.strokeGradient !== void 0;
      if (state.fill !== void 0 && !hasFillGradient) item.fill = state.fill;
      if (state.stroke !== void 0 && !hasStrokeGradient) item.stroke = state.stroke;
      if (state.fillGradient !== void 0) item.fillGradient = state.fillGradient;
      if (state.strokeGradient !== void 0) item.strokeGradient = state.strokeGradient;
      if (state.strokeDashoffset !== void 0) item.strokeDashoffset = fmt(state.strokeDashoffset);
      const hasDashPattern = asset?.kind === "vector" && !!asset.style.strokeDasharray && asset.style.strokeDasharray.length > 0;
      if (state.trim && !hasDashPattern) {
        const attrs = trimToDashAttrs(state.trim);
        item.strokeDasharray = attrs["stroke-dasharray"];
        item.strokeDashoffset = attrs["stroke-dashoffset"];
      }
      return item;
    }).filter((it) => it !== null);
  }
  var SVG_NS = "http://www.w3.org/2000/svg";
  function applyGradientToElement(node, id, g) {
    const owner = node.ownerSVGElement;
    const root = owner ?? node.getRootNode();
    const def = root && "querySelector" in root ? root.querySelector(`#${CSS.escape(id)}`) : null;
    if (!def) return;
    for (const [attr, value] of Object.entries(gradientAttrs(g))) {
      def.setAttribute(attr, value);
    }
    while (def.firstChild) def.removeChild(def.firstChild);
    const doc = def.ownerDocument;
    for (const s of g.stops) {
      const stop = doc.createElementNS(SVG_NS, "stop");
      for (const [attr, value] of Object.entries(gradientStopAttrs(s))) {
        stop.setAttribute(attr, value);
      }
      def.appendChild(stop);
    }
  }
  function applyFrameToNodes(nodes, items) {
    for (const item of items) {
      const node = nodes.get(item.objectId);
      if (!node) continue;
      node.setAttribute("transform", item.transform);
      node.setAttribute("opacity", item.opacity);
      if (item.geometry) {
        const shape = node.firstElementChild;
        if (shape) {
          for (const [attr, value] of Object.entries(item.geometry)) {
            shape.setAttribute(attr, value);
          }
        }
      }
      if (item.pathD !== void 0) {
        const shape = node.firstElementChild;
        if (shape) shape.setAttribute("d", item.pathD);
      }
      if (item.fill !== void 0 || item.stroke !== void 0) {
        const shape = node.firstElementChild;
        if (shape) {
          if (item.fill !== void 0) shape.setAttribute("fill", item.fill);
          if (item.stroke !== void 0) shape.setAttribute("stroke", item.stroke);
        }
      }
      if (item.fillGradient) applyGradientToElement(node, `savig-grad-${item.objectId}-fill`, item.fillGradient);
      if (item.strokeGradient) applyGradientToElement(node, `savig-grad-${item.objectId}-stroke`, item.strokeGradient);
      if (item.strokeDashoffset !== void 0) {
        const shape = node.firstElementChild;
        if (shape) shape.setAttribute("stroke-dashoffset", item.strokeDashoffset);
      }
      if (item.strokeDasharray !== void 0) {
        const shape = node.firstElementChild;
        if (shape) {
          shape.setAttribute("stroke-dasharray", item.strokeDasharray);
          shape.setAttribute("pathLength", "1");
        }
      }
      if (item.textPathD !== void 0) {
        const owner = node.ownerSVGElement;
        const root = owner ?? node.getRootNode();
        const def = root && "querySelector" in root ? root.querySelector(`#${CSS.escape(`savig-textpath-${item.objectId}`)}`) : null;
        if (def) def.setAttribute("d", item.textPathD);
        if (item.textPathStartOffset !== void 0) {
          const tp = node.querySelector("textPath");
          if (tp) tp.setAttribute("startOffset", item.textPathStartOffset);
        }
      }
    }
  }
  function applyCamera(root, project, time) {
    const el = root.querySelector("[data-savig-camera]");
    if (!el) return;
    const transform = computeCameraTransform(project, time);
    if (transform !== null) el.setAttribute("transform", transform);
  }
  function setGroupState(g, display, opacity) {
    const style = g.style;
    style.display = display ? "" : "none";
    style.opacity = opacity === null ? "" : String(opacity);
  }
  function applySceneGroupCamera(root, project, sceneId, camera, localTime) {
    const group = root.querySelector(`[data-savig-scene="${CSS.escape(sceneId)}"]`);
    const camEl = group ? group.querySelector("[data-savig-camera]") : null;
    if (!camEl) return;
    const t = computeSceneCameraTransform(camera, project.meta.width, project.meta.height, localTime);
    if (t !== null) camEl.setAttribute("transform", t);
  }
  function ensureDipOverlay(root, project) {
    const existing = root.querySelector("[data-savig-dip]");
    if (existing) return existing;
    const doc = root.ownerDocument ?? null;
    if (!doc) return null;
    const rect = doc.createElementNS(SVG_NS, "rect");
    rect.setAttribute("data-savig-dip", "");
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", fmt(project.meta.width));
    rect.setAttribute("height", fmt(project.meta.height));
    rect.setAttribute("opacity", "0");
    rect.style.display = "none";
    root.appendChild(rect);
    return rect;
  }
  function applyProjectFrame(root, nodes, project, time) {
    applyFrameToNodes(nodes, computeFrame(project, time));
    if (!project.scenes) {
      applyCamera(root, project, time);
      return;
    }
    const { primary, outgoing } = sceneAtTime(project, time);
    const existingOverlay = root.querySelector("[data-savig-dip]");
    const transition = outgoing ? primary.scene.transitionIn : void 0;
    const dip = transition && transition.kind === "dip" ? transition : null;
    const crossfade = !!(transition && transition.kind === "crossfade");
    const outgoingId = outgoing ? outgoing.scene.id : null;
    let primaryVisible = true;
    let primaryOpacity = null;
    let outgoingVisible = !!outgoing;
    const outgoingOpacity = null;
    if (outgoing && crossfade) {
      primaryOpacity = outgoing.progress;
    } else if (outgoing && dip) {
      const second = outgoing.progress >= 0.5;
      primaryVisible = second;
      outgoingVisible = !second;
    }
    root.querySelectorAll("[data-savig-scene]").forEach((g) => {
      const id = g.getAttribute("data-savig-scene");
      if (id === primary.scene.id) setGroupState(g, primaryVisible, primaryOpacity);
      else if (id === outgoingId) setGroupState(g, outgoingVisible, outgoingOpacity);
      else setGroupState(g, false, null);
    });
    applySceneGroupCamera(root, project, primary.scene.id, primary.scene.camera, primary.localTime);
    if (outgoing) applySceneGroupCamera(root, project, outgoing.scene.id, outgoing.scene.camera, outgoing.localTime);
    if (outgoing && dip) {
      const rect = existingOverlay ?? ensureDipOverlay(root, project);
      if (rect) {
        const p = outgoing.progress;
        const cover = p < 0.5 ? p / 0.5 : (1 - p) / 0.5;
        rect.setAttribute("fill", dip.color);
        rect.setAttribute("opacity", fmt(cover));
        rect.style.display = "";
      }
    } else if (existingOverlay) {
      existingOverlay.style.display = "none";
    }
  }

  // src/index.ts
  var POINTER_KINDS = ["click", "pointerdown", "pointerup"];
  function hasInteractivity(project) {
    if (project.interactions) return true;
    for (const scene of projectScenes(project)) {
      for (const o of scene.objects) {
        if (o.behaviors && o.behaviors.length > 0) return true;
      }
    }
    return false;
  }
  function applyOverridesPassRuntime(nodes, expanded) {
    for (const [renderId, o] of expanded) {
      const node = nodes.get(renderId);
      if (!node) continue;
      if (o.hidden !== void 0) node.setAttribute("display", o.hidden ? "none" : "");
      if (o.opacity !== void 0) node.setAttribute("opacity", String(o.opacity));
      if (o.dx !== void 0 || o.dy !== void 0) {
        node.setAttribute("transform", `translate(${o.dx ?? 0} ${o.dy ?? 0}) ${node.getAttribute("transform") ?? ""}`);
      }
      if (o.text !== void 0) {
        const textEl = node.tagName.toLowerCase() === "text" ? node : node.querySelector("text");
        if (textEl) {
          const container = textEl.querySelector("textPath") ?? textEl;
          container.textContent = o.text;
        }
      }
    }
  }
  function create(options) {
    const { svg, project, audio } = options;
    const duration = computeProjectDuration(project);
    const nodes = /* @__PURE__ */ new Map();
    svg.querySelectorAll("[data-savig-object]").forEach((node) => {
      const id = node.getAttribute("data-savig-object");
      if (id) nodes.set(id, node);
    });
    const apply2 = (time) => {
      applyProjectFrame(svg, nodes, project, time);
    };
    let clock = createClock();
    let interactiveSession = null;
    let autoplayIntent = true;
    const repaintOverridesOnly = () => {
      if (!interactiveSession) return;
      applyOverridesPassRuntime(nodes, expandOverrides(project, interactiveSession.overrides(), nodes.keys()));
    };
    let loopPending = false;
    const scheduleLoop = () => {
      if (loopPending) return;
      loopPending = true;
      requestAnimationFrame(loop);
    };
    function loop(timestamp) {
      loopPending = false;
      clock = advance(clock, timestamp / 1e3, duration, project.meta.loop);
      apply2(clock.time);
      if (interactiveSession) {
        interactiveSession.tickTo(clock.time, clock.playing);
        repaintOverridesOnly();
      }
      if (clock.playing) scheduleLoop();
    }
    if (hasInteractivity(project)) {
      const host = {
        play: () => {
          clock = play(clock, performance.now() / 1e3);
          autoplayIntent = true;
          scheduleLoop();
        },
        pause: () => {
          clock = pause(clock);
          autoplayIntent = false;
        },
        seek: (t) => {
          const clamped = Math.min(Math.max(0, t), duration > 0 ? duration : Number.MAX_VALUE);
          clock = seek(clock, clamped);
          apply2(clock.time);
          repaintOverridesOnly();
        },
        now: () => clock.time,
        random: Math.random,
        warn: (m) => console.warn("[savig]", m)
      };
      const session = createSession(project, host);
      interactiveSession = session;
      session.onChange(() => {
        if (!clock.playing) {
          apply2(clock.time);
          repaintOverridesOnly();
        }
      });
      const chainFromTarget = (target) => {
        const el = target instanceof Element ? target.closest("[data-savig-object]") : null;
        const renderId = el?.getAttribute("data-savig-object");
        return renderId ? resolveAuthoredChain(project, renderId) : [];
      };
      for (const kind of POINTER_KINDS) {
        svg.addEventListener(kind, (e) => {
          const chain = chainFromTarget(e.target);
          if (chain.length > 0) session.firePointer(kind, chain);
        });
      }
      svg.addEventListener("pointerover", (e) => {
        const chain = chainFromTarget(e.target);
        session.pointerAt(chain.length > 0 ? chain : null);
      });
      svg.addEventListener("pointerout", (e) => {
        const related = e.relatedTarget;
        if (related instanceof Node && svg.contains(related)) return;
        session.pointerAt(null);
      });
      const doc = svg.ownerDocument;
      doc.addEventListener("keydown", (e) => {
        if (e.repeat) return;
        session.fireKey("keydown", e.key);
      });
      doc.addEventListener("keyup", (e) => {
        if (e.repeat) return;
        session.fireKey("keyup", e.key);
      });
    }
    apply2(clock.time);
    if (autoplayIntent) {
      clock = play(clock, performance.now() / 1e3);
      createAudioStarter(project.audioClips, project.audioTracks, audio)();
    }
    scheduleLoop();
    globalThis.savigSeek = (t) => {
      apply2(t);
      repaintOverridesOnly();
    };
  }
  function createAudioStarter(clips, tracks, audio) {
    return () => {
      if (clips.length === 0) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const decoded = /* @__PURE__ */ new Map();
      const decodeAll = clips.map(async (clip) => {
        if (decoded.has(clip.assetId) || !audio[clip.assetId]) return;
        const bytes = Uint8Array.from(atob(audio[clip.assetId]), (c) => c.charCodeAt(0));
        decoded.set(clip.assetId, await ctx.decodeAudioData(bytes.buffer));
      });
      void Promise.all(decodeAll).then(() => {
        const chains = /* @__PURE__ */ new Map();
        for (const { clip } of resolveActiveClips(clips, 0)) {
          schedule(ctx, decoded, clip, chainInput(ctx, chains, tracks, clip.trackId));
        }
        for (const clip of clips) {
          if (clip.startTime > 0) schedule(ctx, decoded, clip, chainInput(ctx, chains, tracks, clip.trackId));
        }
      });
    };
  }
  function chainInput(ctx, chains, tracks, trackId) {
    const key = trackId && tracks?.some((t) => t.id === trackId) ? trackId : "";
    const hit = chains.get(key);
    if (hit) return hit;
    const state = resolveTrackState(tracks, key || void 0);
    const input = ctx.createGain();
    input.gain.value = state.audible ? state.gain : 0;
    let tail = input;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = state.pan;
      tail.connect(p);
      tail = p;
    }
    if (state.filter) {
      const f = ctx.createBiquadFilter();
      f.type = state.filter.kind;
      f.frequency.value = state.filter.frequency;
      tail.connect(f);
      tail = f;
    }
    tail.connect(ctx.destination);
    chains.set(key, input);
    return input;
  }
  function schedule(ctx, decoded, clip, into) {
    const buffer = decoded.get(clip.assetId);
    if (!buffer) return;
    const gain = ctx.createGain();
    const envelope = fadeEnvelopePoints(clip, 0);
    if (((clip.fadeIn ?? 0) > 0 || (clip.fadeOut ?? 0) > 0) && envelope.length) {
      const base = ctx.currentTime;
      gain.gain.setValueAtTime(clip.volume * envelope[0].gain, base + envelope[0].t);
      for (const p of envelope.slice(1)) gain.gain.linearRampToValueAtTime(clip.volume * p.gain, base + p.t);
    } else {
      gain.gain.value = clip.volume;
    }
    gain.connect(into);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start(ctx.currentTime + Math.max(0, clip.startTime), clip.inPoint, clip.outPoint - clip.inPoint);
  }
  globalThis.SavigRuntime = { create };
})();
