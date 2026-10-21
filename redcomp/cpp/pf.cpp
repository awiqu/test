// PathFinder для глобального маршрутизатора (зеркало lattice.PFRouter без вентилей).
// Узлы (i,j,l), l: 0 - нижний слой, 1 - верхний (y=2). Улицы (узел-низ, dir 0=E 1=S, слой).
// stdin: ni nj / nblk (i j)* / npinblk (i j dir)* / nnodes pinown (i j net)* / nnets, на сеть: nterm (i j)* /
//        iters pf0 pfmult
// stdout: OK|FAIL ...; на сеть: N k, на сегмент: P, узлы "n i j l"
#include <bits/stdc++.h>
using namespace std;

int ni, nj, N, NR;
vector<char> blk, hardStreet, noRamp;
vector<int> pinown;
vector<vector<int>> users;
vector<float> hist;
int curNet;
float pf;
const int DI[4] = {1, 0, -1, 0}, DJ[4] = {0, 1, 0, -1};

inline int nodeId(int i, int j, int l) { return (j * ni + i) * 2 + l; }
inline int rn(int i, int j, int l) { return nodeId(i, j, l); }
inline int rs(int lo_i, int lo_j, int dir, int l) { return 2 * N + (((lo_j * ni + lo_i) * 2 + dir) * 2 + l); }
inline int keyOf(int i, int j, int d, int &lo_i, int &lo_j, int &dir) {
    if (d == 0) { lo_i = i; lo_j = j; dir = 0; }
    else if (d == 1) { lo_i = i; lo_j = j; dir = 1; }
    else if (d == 2) { lo_i = i - 1; lo_j = j; dir = 0; }
    else { lo_i = i; lo_j = j - 1; dir = 1; }
    return (lo_j * ni + lo_i) * 2 + dir;
}
inline float cst(int r) {
    int others = 0;
    for (int u : users[r]) if (u != curNet) others++;
    return (1.0f + hist[r]) * (1.0f + pf * others);
}
inline bool nodeOK(int i, int j) {
    if (blk[j * ni + i]) return pinown[j * ni + i] == curNet;
    return true;
}
inline bool hardNode0(int i, int j) { int o = pinown[j * ni + i]; return o >= 0 && o != curNet; }

// per-net modes
vector<char> curRamp, curFlat, curLow, curD2;   // ramp/flat: по ключу улицы, low/d2: по узлу (i,j)
vector<int> touched;                            // для быстрой очистки
vector<float> gsc; vector<int> stampv, came, cameKey; vector<char> cameMove;
int curStamp = 0;

struct St { float f, g; int n, last; };
struct Cmp { bool operator()(const St &a, const St &b) const { return a.f > b.f; } };

bool astar(const vector<int> &sources, const vector<char> &isT, const vector<array<int,2>> &tl, vector<array<int,3>> &outPath, int &endN) {
    curStamp++;
    priority_queue<St, vector<St>, Cmp> pq;
    auto H = [&](int i, int j) { int b = INT_MAX; for (auto &t : tl) b = min(b, abs(i - t[0]) + abs(j - t[1])); return (float)b; };
    for (int s : sources) {
        int c = s >> 1;
        gsc[s] = 0; stampv[s] = curStamp; came[s] = -1; cameKey[s] = -1;
        pq.push({H(c % ni, c / ni), 0, s, -1});
    }
    while (!pq.empty()) {
        St cur = pq.top(); pq.pop();
        int n = cur.n;
        if (stampv[n] != curStamp || cur.g > gsc[n]) continue;
        if (isT[n]) { endN = n; goto found; }
        {
            int l = n & 1, c = n >> 1, i = c % ni, j = c / ni;
            for (int d = 0; d < 4; d++) {
                int i2 = i + DI[d], j2 = j + DJ[d];
                if (i2 < 0 || j2 < 0 || i2 >= ni || j2 >= nj) continue;
                int lo_i, lo_j, dir; int key = keyOf(i, j, d, lo_i, lo_j, dir);
                if (key == cur.last) continue;
                // плоский
                if (!hardStreet[((lo_j * ni + lo_i) * 2 + dir) * 2 + l] && !(l == 0 && hardNode0(i2, j2)) && nodeOK(i2, j2)
                    && !curRamp[key] && !(l == 1 && (curLow[j2 * ni + i2] || curLow[j * ni + i]))) {
                    int n2 = nodeId(i2, j2, l);
                    float ng = cur.g + cst(rn(i2, j2, l)) + cst(rs(lo_i, lo_j, dir, l));
                    if (stampv[n2] != curStamp || ng < gsc[n2]) {
                        stampv[n2] = curStamp; gsc[n2] = ng; came[n2] = n; cameKey[n2] = key; cameMove[n2] = 0;
                        pq.push({ng + H(i2, j2), ng, n2, key});
                    }
                }
                // рампа
                if (hardStreet[((lo_j * ni + lo_i) * 2 + dir) * 2 + 0] || hardStreet[((lo_j * ni + lo_i) * 2 + dir) * 2 + 1]) continue;
                int li, lj, hi, hj;
                if (l == 0) { li = i; lj = j; hi = i2; hj = j2; } else { li = i2; lj = j2; hi = i; hj = j; }
                if (!nodeOK(li, lj) || !nodeOK(hi, hj)) continue;
                if (hardNode0(li, lj) || noRamp[lj * ni + li] || pinown[lj * ni + li] >= 0) continue;   // на пинах только плоский подход: у пина будет регенератор
                if (curFlat[key] || curD2[lj * ni + li]) continue;
                int n2 = nodeId(i2, j2, 1 - l);
                float ng = cur.g + cst(rs(lo_i, lo_j, dir, 0)) + cst(rs(lo_i, lo_j, dir, 1)) + cst(rn(li, lj, 1)) + cst(rn(hi, hj, 1)) + cst(rn(li, lj, 0)) + 2.0f;
                if (stampv[n2] != curStamp || ng < gsc[n2]) {
                    stampv[n2] = curStamp; gsc[n2] = ng; came[n2] = n; cameKey[n2] = key; cameMove[n2] = 1;
                    pq.push({ng + H(i2, j2), ng, n2, key});
                }
            }
        }
    }
    return false;
found:
    outPath.clear();
    for (int n = endN; n != -1; n = came[n]) { int c = n >> 1; outPath.push_back({c % ni, c / ni, n & 1}); }
    reverse(outPath.begin(), outPath.end());
    return true;
}

int main() {
    scanf("%d %d", &ni, &nj); N = ni * nj; NR = 2 * N + 4 * N;
    blk.assign(N, 0); pinown.assign(N, -1);
    int nb; scanf("%d", &nb); for (int k = 0; k < nb; k++) { int i, j; scanf("%d %d", &i, &j); blk[j * ni + i] = 1; }
    hardStreet.assign(N * 4, 0);
    int np; scanf("%d", &np); for (int k = 0; k < np; k++) { int i, j, d; scanf("%d %d %d", &i, &j, &d);
        int lo_i, lo_j, dir; keyOf(i, j, d, lo_i, lo_j, dir);
        if (lo_i < 0 || lo_j < 0 || lo_i >= ni || lo_j >= nj) continue;
        hardStreet[((lo_j * ni + lo_i) * 2 + dir) * 2 + 0] = hardStreet[((lo_j * ni + lo_i) * 2 + dir) * 2 + 1] = 1; }
    int npo; scanf("%d", &npo); for (int k = 0; k < npo; k++) { int i, j, o; scanf("%d %d %d", &i, &j, &o); pinown[j * ni + i] = o; }
    noRamp.assign(N, 0);
    int nnr; scanf("%d", &nnr); for (int k = 0; k < nnr; k++) { int i, j; scanf("%d %d", &i, &j); noRamp[j * ni + i] = 1; }
    int nn; scanf("%d", &nn);
    vector<vector<array<int,2>>> terms(nn);
    for (int k = 0; k < nn; k++) { int nt; scanf("%d", &nt); terms[k].resize(nt); for (auto &t : terms[k]) scanf("%d %d", &t[0], &t[1]); }
    int iters; float pf0, pfm; scanf("%d %f %f", &iters, &pf0, &pfm);
    users.assign(NR, {}); hist.assign(NR, 0.f);
    gsc.assign(2 * N, 0); stampv.assign(2 * N, 0); came.assign(2 * N, -1); cameKey.assign(2 * N, -1); cameMove.assign(2 * N, 0);
    curRamp.assign(N * 2, 0); curFlat.assign(N * 2, 0); curLow.assign(N, 0); curD2.assign(N, 0);
    vector<vector<int>> netRes(nn);
    vector<vector<vector<array<int,3>>>> routes(nn);
    auto span = [&](int k) { int a = INT_MAX, b = -1, c = INT_MAX, d = -1; for (auto &t : terms[k]) { a = min(a, t[0]); b = max(b, t[0]); c = min(c, t[1]); d = max(d, t[1]); } return (b - a) + (d - c); };
    vector<int> order(nn); iota(order.begin(), order.end(), 0);
    stable_sort(order.begin(), order.end(), [&](int a, int b) { return span(a) < span(b); });
    pf = pf0;
    bool ok = false;
    for (int it = 0; it < iters; it++) {
        for (int k : order) {
            curNet = k;
            for (int r : netRes[k]) { auto &u = users[r]; u.erase(remove(u.begin(), u.end(), k), u.end()); }
            netRes[k].clear(); routes[k].clear();
            set<int> res;
            auto &tm = terms[k];
            if (tm.size() < 2) { if (!tm.empty()) res.insert(rn(tm[0][0], tm[0][1], 0)); }
            else {
                vector<int> tree; tree.push_back(nodeId(tm[0][0], tm[0][1], 0)); res.insert(tree[0]);
                vector<array<int,2>> rest(tm.begin() + 1, tm.end());
                // отмена режимов предыдущей сети
                fill(curRamp.begin(), curRamp.end(), 0); fill(curFlat.begin(), curFlat.end(), 0);
                fill(curLow.begin(), curLow.end(), 0); fill(curD2.begin(), curD2.end(), 0);
                while (!rest.empty()) {
                    vector<char> isT(2 * N, 0);
                    for (auto &t : rest) isT[nodeId(t[0], t[1], 0)] = 1;
                    vector<array<int,3>> path; int endN;
                    if (!astar(tree, isT, rest, path, endN)) { printf("FAIL %d\n", k); return 1; }
                    routes[k].push_back(path);
                    for (auto &p : path) { tree.push_back(nodeId(p[0], p[1], p[2])); res.insert(nodeId(p[0], p[1], p[2])); if (p[2] == 1) curD2[p[1] * ni + p[0]] = 1; }
                    for (size_t q = 1; q < path.size(); q++) {
                        auto &a = path[q - 1], &b = path[q];
                        int d = -1; for (int dd = 0; dd < 4; dd++) if (a[0] + DI[dd] == b[0] && a[1] + DJ[dd] == b[1]) d = dd;
                        int lo_i, lo_j, dir; int key = keyOf(a[0], a[1], d, lo_i, lo_j, dir);
                        if (a[2] == b[2]) { res.insert(rs(lo_i, lo_j, dir, a[2])); curFlat[key] = 1; }
                        else {
                            int li = a[2] == 0 ? a[0] : b[0], lj = a[2] == 0 ? a[1] : b[1];
                            res.insert(rs(lo_i, lo_j, dir, 0)); res.insert(rs(lo_i, lo_j, dir, 1)); res.insert(rn(li, lj, 1));
                            curRamp[key] = 1; curLow[lj * ni + li] = 1;
                        }
                    }
                    for (auto q = rest.begin(); q != rest.end();) { if (nodeId((*q)[0], (*q)[1], 0) == endN) q = rest.erase(q); else ++q; }
                }
            }
            for (int r : res) { users[r].push_back(k); netRes[k].push_back(r); }
        }
        int over = 0;
        for (int r = 0; r < NR; r++) if (users[r].size() > 1) over++;
        fprintf(stderr, "итерация %d: перегрузка %d pf=%.2f\n", it, over, pf);
        if (!over) { ok = true; break; }
        for (int r = 0; r < NR; r++) if (users[r].size() > 1) hist[r] += 0.5f * (users[r].size() - 1);
        pf *= pfm;
    }
    if (!ok) { printf("OVERUSE\n"); return 2; }
    printf("OK\n");
    for (int k = 0; k < nn; k++) {
        printf("N %d\n", k);
        for (auto &sg : routes[k]) { printf("P\n"); for (auto &p : sg) printf("n %d %d %d\n", p[0], p[1], p[2] ? 2 : 0); }
    }
    return 0;
}
