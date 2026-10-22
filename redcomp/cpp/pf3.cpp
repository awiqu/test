// PathFinder для глобального маршрутизатора, L слоёв (зеркало lattice.Router3).
// Узлы (i,j,l), l = 0..L-1 (высота провода y0+2l). Улицы (узел-низ, dir 0=E 1=S, слой).
// Рампа соединяет соседние по решётке узлы на слоях l и l+1.
// stdin: ni nj L / nblk (i j nl)* — узел закрыт на слоях < nl (препятствия-модули) /
//        npinblk (i j dir)* / npin (i j net)* / nnets, на сеть: nterm (i j)* / iters pf0 pfmult
// stdout: OK|FAIL|OVERUSE ...; на сеть: N k, на сегмент: P, узлы "n i j l"
#include <bits/stdc++.h>
using namespace std;

int ni, nj, L, N, NR;
const int RM = 4;                       // не более RM рамп подряд (на рампе повторитель не поставить)
vector<unsigned char> blkL;
vector<char> hardStreet;                // по (улица, слой): ключ*L+слой
vector<int> pinown3;                    // владелец пина в узле на слое (N*L), -1 нет
vector<vector<int>> users;
vector<float> hist;
int curNet;
float pf;
const int DI[4] = {1, 0, -1, 0}, DJ[4] = {0, 1, 0, -1};

inline int nodeId(int i, int j, int l) { return (j * ni + i) * L + l; }
inline int rs(int lo_i, int lo_j, int dir, int l) { return N * L + (((lo_j * ni + lo_i) * 2 + dir) * L + l); }
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
inline bool nodeOK(int i, int j, int l) {
    int c = j * ni + i;
    if (l < (int)blkL[c]) return pinown3[nodeId(i, j, l)] == curNet;
    return true;
}
inline bool hardPin(int i, int j, int l) { int o = pinown3[nodeId(i, j, l)]; return o >= 0 && o != curNet; }
inline bool isPin(int i, int j, int l) { return pinown3[nodeId(i, j, l)] >= 0; }

// per-net состояние (сбрасывается списком затронутых индексов)
vector<char> curRamp, curFlat;          // по ключу улицы
vector<signed char> curRampLam;         // нижний слой рампы на улице (-1 нет)
vector<vector<char>> curLow, curUse;    // [слой][узел (i,j)]
vector<int> tRamp, tFlat; vector<array<int,2>> tLow, tUse;
void clearCur() {
    for (int k : tRamp) { curRamp[k] = 0; curRampLam[k] = -1; }
    for (int k : tFlat) curFlat[k] = 0;
    for (auto &p : tLow) curLow[p[0]][p[1]] = 0;
    for (auto &p : tUse) curUse[p[0]][p[1]] = 0;
    tRamp.clear(); tFlat.clear(); tLow.clear(); tUse.clear();
}

vector<float> gsc; vector<int> stampv, came, cameKey; vector<int> tgtStamp;
vector<int> treeRun, trTouched;        // для узлов дерева цепи: длина текущей цепочки рамп (по узлу)
void clearRun() { for (int n : trTouched) treeRun[n] = 0; trTouched.clear(); }
int curStamp = 0, tgtSt = 0;

struct St { float f, g; int n, last; };
struct Cmp { bool operator()(const St &a, const St &b) const { return a.f > b.f; } };

bool astar(const vector<int> &sources, const vector<array<int,3>> &tl, vector<array<int,3>> &outPath, int &endN) {
    curStamp++;
    priority_queue<St, vector<St>, Cmp> pq;
    auto H = [&](int i, int j) { int b = INT_MAX; for (auto &t : tl) b = min(b, abs(i - t[0]) + abs(j - t[1])); return 2.0f * b; };
    const int S1 = RM + 1;
    for (int s0 : sources) {
        int st = s0 * S1 + treeRun[s0];
        int c = s0 / L;
        gsc[st] = 0; stampv[st] = curStamp; came[st] = -1; cameKey[st] = -1;
        pq.push({H(c % ni, c / ni), 0, st, -1});
    }
    int endSt = -1;
    while (!pq.empty()) {
        St cur = pq.top(); pq.pop();
        int stt = cur.n;
        if (stampv[stt] != curStamp || cur.g > gsc[stt]) continue;
        int n = stt / S1, r = stt % S1;
        if (tgtStamp[n] == tgtSt) { endSt = stt; endN = n; goto found; }
        {
            int l = n % L, c = n / L, i = c % ni, j = c / ni;
            for (int d = 0; d < 4; d++) {
                int i2 = i + DI[d], j2 = j + DJ[d];
                if (i2 < 0 || j2 < 0 || i2 >= ni || j2 >= nj) continue;
                int lo_i, lo_j, dir; int key = keyOf(i, j, d, lo_i, lo_j, dir);
                if (key == cur.last) continue;
                int c2 = j2 * ni + i2;
                // плоский шаг
                if (!hardStreet[key * L + l] && !hardPin(i2, j2, l) && nodeOK(i2, j2, l) && !curRamp[key]
                    && !(l >= 1 && (curLow[l - 1][c2] || curLow[l - 1][c]))) {
                    int n2 = nodeId(i2, j2, l);
                    int s2 = n2 * S1;
                    float ng = cur.g + cst(n2) + cst(rs(lo_i, lo_j, dir, l));
                    if (stampv[s2] != curStamp || ng < gsc[s2]) {
                        stampv[s2] = curStamp; gsc[s2] = ng; came[s2] = stt; cameKey[s2] = key;
                        pq.push({ng + H(i2, j2), ng, s2, key});
                    }
                }
                // рампа вверх (l -> l+1) и вниз (l -> l-1)
                if (r + 1 > RM) continue;
                for (int up = 0; up < 2; up++) {
                    int lam, li, lj, hi, hj, l2;
                    if (up) { if (l + 1 >= L) continue; lam = l; li = i; lj = j; hi = i2; hj = j2; l2 = l + 1; }
                    else { if (l == 0) continue; lam = l - 1; li = i2; lj = j2; hi = i; hj = j; l2 = l - 1; }
                    int lc = lj * ni + li;
                    if (!nodeOK(li, lj, lam) || !nodeOK(li, lj, lam + 1) || !nodeOK(hi, hj, lam + 1)) continue;
                    if (isPin(li, lj, lam) || isPin(li, lj, lam + 1) || isPin(hi, hj, lam + 1)) continue;   // на пинах только плоский подход
                    if (hardStreet[key * L + lam] || hardStreet[key * L + lam + 1]) continue;
                    if (curFlat[key] || curUse[lam + 1][lc]) continue;
                    if ((lam & 1) != dir) continue;     // рампы смежных пар слоёв не делят улицу: чётные — по E-W, нечётные — по N-S
                    int n2 = nodeId(i2, j2, l2);
                    int s2 = n2 * S1 + r + 1;
                    float ng = cur.g + cst(rs(lo_i, lo_j, dir, lam)) + cst(rs(lo_i, lo_j, dir, lam + 1))
                             + cst(nodeId(li, lj, lam + 1)) + cst(nodeId(hi, hj, lam + 1)) + cst(nodeId(li, lj, lam)) + 2.0f;
                    if (stampv[s2] != curStamp || ng < gsc[s2]) {
                        stampv[s2] = curStamp; gsc[s2] = ng; came[s2] = stt; cameKey[s2] = key;
                        pq.push({ng + H(i2, j2), ng, s2, key});
                    }
                }
            }
        }
    }
    return false;
found:
    outPath.clear();
    for (int st = endSt; st != -1; st = came[st]) { int n = st / S1; int c = n / L; outPath.push_back({c % ni, c / ni, n % L}); }
    reverse(outPath.begin(), outPath.end());
    return true;
}

int main() {
    scanf("%d %d %d", &ni, &nj, &L); N = ni * nj; NR = N * L + N * 2 * L;
    blkL.assign(N, 0); pinown3.assign((size_t)N * L, -1);
    int nb; scanf("%d", &nb); for (int k = 0; k < nb; k++) { int i, j, nl; scanf("%d %d %d", &i, &j, &nl); blkL[j * ni + i] = nl; }
    hardStreet.assign((size_t)N * 2 * L, 0);
    int np; scanf("%d", &np); for (int k = 0; k < np; k++) { int i, j, d, lay; scanf("%d %d %d %d", &i, &j, &d, &lay);
        int lo_i, lo_j, dir; int key = keyOf(i, j, d, lo_i, lo_j, dir);
        if (lo_i < 0 || lo_j < 0 || lo_i >= ni || lo_j >= nj) continue;
        hardStreet[key * L + lay] = 1; }
    int npo; scanf("%d", &npo); for (int k = 0; k < npo; k++) { int i, j, o, lay; scanf("%d %d %d %d", &i, &j, &o, &lay); pinown3[nodeId(i, j, lay)] = o; }
    int nn; scanf("%d", &nn);
    vector<vector<array<int,3>>> terms(nn);
    for (int k = 0; k < nn; k++) { int nt; scanf("%d", &nt); terms[k].resize(nt); for (auto &t : terms[k]) scanf("%d %d %d", &t[0], &t[1], &t[2]); }
    int iters; float pf0, pfm; scanf("%d %f %f", &iters, &pf0, &pfm);
    users.assign(NR, {}); hist.assign(NR, 0.f);
    gsc.assign((size_t)N * L * (RM + 1), 0); stampv.assign((size_t)N * L * (RM + 1), 0); came.assign((size_t)N * L * (RM + 1), -1); cameKey.assign((size_t)N * L * (RM + 1), -1); tgtStamp.assign(N * L, 0); treeRun.assign(N * L, 0);
    curRamp.assign(N * 2, 0); curFlat.assign(N * 2, 0); curRampLam.assign(N * 2, -1);
    curLow.assign(L, vector<char>(N, 0)); curUse.assign(L, vector<char>(N, 0));
    vector<vector<int>> netRes(nn);
    vector<vector<vector<array<int,3>>>> routes(nn);
    auto span = [&](int k) { int a = INT_MAX, b = -1, c = INT_MAX, d = -1; for (auto &t : terms[k]) { a = min(a, t[0]); b = max(b, t[0]); c = min(c, t[1]); d = max(d, t[1]); } return (b - a) + (d - c); };
    vector<int> order(nn); iota(order.begin(), order.end(), 0);
    stable_sort(order.begin(), order.end(), [&](int a, int b) { return span(a) < span(b); });
    pf = pf0;
    bool ok = false;
    static mt19937 rng(12345);
    for (int it = 0; it < iters; it++) {
        for (int k : order) {
            curNet = k;
            for (int r : netRes[k]) { auto &u = users[r]; u.erase(remove(u.begin(), u.end(), k), u.end()); }
            netRes[k].clear(); routes[k].clear();
            set<int> res;
            auto &tm = terms[k];
            if (tm.size() < 2) { if (!tm.empty()) res.insert(nodeId(tm[0][0], tm[0][1], tm[0][2])); }
            else {
                bool done = false;
                vector<array<int,3>> lastRest;
                for (int attempt = 0; attempt < 8 && !done; attempt++) {
                    res.clear(); routes[k].clear(); clearCur(); clearRun();
                    vector<int> tree; tree.push_back(nodeId(tm[0][0], tm[0][1], tm[0][2])); res.insert(tree[0]);
                    vector<array<int,3>> rest(tm.begin() + 1, tm.end());
                    if (attempt > 0) shuffle(rest.begin(), rest.end(), rng);
                    bool fail = false;
                    while (!rest.empty()) {
                        tgtSt++;
                        vector<array<int,3>> targets;
                        if (attempt == 0) { for (auto &t : rest) tgtStamp[nodeId(t[0], t[1], t[2])] = tgtSt; targets = rest; }
                        else { tgtStamp[nodeId(rest[0][0], rest[0][1], rest[0][2])] = tgtSt; targets = {rest[0]}; }
                        vector<array<int,3>> path; int endN;
                        bool okp = astar(tree, targets, path, endN);
                        if (!okp) { fail = true; lastRest = rest; break; }
                        routes[k].push_back(path);
                        {   // длина цепочки рамп в каждом узле нового пути (старт — по дереву)
                            int r = treeRun[nodeId(path[0][0], path[0][1], path[0][2])];
                            for (size_t q = 1; q < path.size(); q++) {
                                r = (path[q][2] == path[q - 1][2]) ? 0 : r + 1;
                                int nd = nodeId(path[q][0], path[q][1], path[q][2]);
                                if (r > treeRun[nd]) { if (treeRun[nd] == 0) trTouched.push_back(nd); treeRun[nd] = r; }
                            }
                        }
                        for (auto &p : path) {
                            int nd = nodeId(p[0], p[1], p[2]);
                            tree.push_back(nd); res.insert(nd);
                            int c = p[1] * ni + p[0];
                            if (!curUse[p[2]][c]) { curUse[p[2]][c] = 1; tUse.push_back({p[2], c}); }
                        }
                        for (size_t q = 1; q < path.size(); q++) {
                            auto &a = path[q - 1], &b = path[q];
                            int d = -1; for (int dd = 0; dd < 4; dd++) if (a[0] + DI[dd] == b[0] && a[1] + DJ[dd] == b[1]) d = dd;
                            int lo_i, lo_j, dir; int key = keyOf(a[0], a[1], d, lo_i, lo_j, dir);
                            if (a[2] == b[2]) { res.insert(rs(lo_i, lo_j, dir, a[2])); if (!curFlat[key]) { curFlat[key] = 1; tFlat.push_back(key); } }
                            else {
                                int lam = min(a[2], b[2]);
                                int li = a[2] < b[2] ? a[0] : b[0], lj = a[2] < b[2] ? a[1] : b[1];
                                int hi = a[2] < b[2] ? b[0] : a[0], hj = a[2] < b[2] ? b[1] : a[1];
                                res.insert(rs(lo_i, lo_j, dir, lam)); res.insert(rs(lo_i, lo_j, dir, lam + 1));
                                res.insert(nodeId(li, lj, lam + 1)); res.insert(nodeId(hi, hj, lam + 1)); res.insert(nodeId(li, lj, lam));
                                if (!curRamp[key]) { curRamp[key] = 1; curRampLam[key] = lam; tRamp.push_back(key); }
                                int lc = lj * ni + li;
                                if (!curLow[lam][lc]) { curLow[lam][lc] = 1; tLow.push_back({lam, lc}); }
                            }
                        }
                        for (auto q = rest.begin(); q != rest.end();) { if (nodeId((*q)[0], (*q)[1], (*q)[2]) == endN) q = rest.erase(q); else ++q; }
                    }
                    if (!fail) done = true;
                }
                clearCur(); clearRun();
                if (!done) { printf("FAIL %d\n", k); for (auto &t : lastRest) printf("T %d %d\n", t[0], t[1]); return 1; }
            }
            for (int r : res) { users[r].push_back(k); netRes[k].push_back(r); }
        }
        int over = 0;
        for (int r = 0; r < NR; r++) if (users[r].size() > 1) over++;
        fprintf(stderr, "итерация %d: перегрузка %d pf=%.2f\n", it, over, pf);
        if (!over) { ok = true; break; }
        for (int r = 0; r < NR; r++) if (users[r].size() > 1) hist[r] += 0.5f * (users[r].size() - 1);
        pf = min(pf * pfm, 20000.0f);
    }
    if (!ok) {
        printf("OVERUSE\n");
        for (int r = 0; r < NR; r++) if (users[r].size() > 1) {
            if (r < N * L) printf("O n %d %d %d\n", (r / L) % ni, (r / L) / ni, r % L);
            else { int q = r - N * L; int l = q % L, dir = (q / L) % 2, c = q / (2 * L); printf("O s %d %d %d %d\n", c % ni, c / ni, dir, l); }
        }
        return 2;
    }
    printf("OK\n");
    for (int k = 0; k < nn; k++) {
        printf("N %d\n", k);
        for (auto &sg : routes[k]) { printf("P\n"); for (auto &p : sg) printf("n %d %d %d\n", p[0], p[1], p[2]); }
    }
    return 0;
}
