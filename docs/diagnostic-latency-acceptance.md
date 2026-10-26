# 诊断查询与数据推送验收

## v0.14.11：完整请求字节按不可变切面复用（2026-10-26）

第40轮只读已测matcher/pool detect/dispatch、typed worker、requestImpact与plan retry/cascade局部。Worker路径是一遍JSON完整inputBytes预算与postMessage必要原生clone，不伪称可删冗余，未改计时/取消/完整输入预算。真实重复在requestImpact级联与budget-retry反复JSON序列化同一baseline。新TS publicRequestBytes原字段顺序/完整UTF8 bytes不变，createRequestPlanCache在Host统一request-plan-bytes namespace按本操作不可变候选各序列化一次；候选写完才计量，下一轮clone后写，不跨独立preview借mutable identity。requestImpact仍原完整Buffer前缀/相等/后缀算法，所有request-byte/cache-change预算每次检查；没有size-only/截断/第二缓存。close清除字节与分析/块索引并禁止闭后复活。

新增3单元覆盖完整public字段顺序/Unicode/非public排除，20候选3轮比较只21payload stringify并与原比较逐值一致、预算边界反复检查；真实circular错误不发布、修正显式retry、下一operation读mutable新输入、关闭释放与拒读。真实千消息三级链原Host回归新增完整payload serialize4次（基准+3候选）/project1003，源不变、输出独立可写、native复用/统一cache释放保持；7定向单元与6实质Host通过（另5空suite不计实质）。定向三级链475.56ms/HTTP102.34ms/另一Agent114.66ms/CPU656+109ms/loop31.74ms；工具539.99ms/HTTP49.76ms/另一Agent61.83ms/CPU844+78ms/loop168.30ms/catalog3/record14/token5/native500/pause-resume保持。后CPU仅同一三级链1实质458.31ms/HTTP97.01ms/另一Agent106.72ms/CPU578+250ms/loop32.92ms/byteSerializations4；无同负载前后CPU配对，不编整体加速比。必要完整prefix扫描/冷copy/包络/Worker输入计量传输及无revision外部比较仍有成本。最终release:check strict/104JS/62事件目录、522/522单元（17897.32ms）及Host/Client构建通过；同次完整Host千消息三级链448.35ms/HTTP31.03ms/另一Agent41.47ms/CPU703+32ms/loop34.50ms/byteSerializations4/project1003；工具513.10ms/HTTP39.05ms/另一Agent47.16ms/两次测量preview CPU750+156ms/loop169.21ms/catalog3/record14/token5/native500；2012工作台display465.03/3.71ms、reconcile585.52/4.46ms、reconcile HTTP3.84ms、HTTP38.43ms/另一Agent57.15ms/CPU829+266ms/loop44.34ms/native2012；4002提醒4.13/0.20ms/historyReads0/HTTP24.53ms/另一Agent34.91ms/CPU15+16ms/loop23.22ms。最终完整源码Host218/218（246452.45ms）、Client3文件24/24（3.80s）；7001诊断cold153.21/warm2.60/append2.61ms/20阶段87.57ms/HTTP29.49ms/另一Agent44.17ms/CPU563+15ms/loop141.69ms/native7001；1000改写20新增无外部105.24ms/HTTP104.20ms/另一Agent112.79ms/CPU172+0ms/loop74.32ms/wire1020，fresh外部180.68ms/HTTP179.04ms/另一Agent188.66ms/CPU250+0ms/loop96.73ms/wire1540，均21帧/delta1/phase0新增native。桌面0.2.1-rc.3 ASAR隔离24/24实质、0skip、stderr空、exit0（22448.66ms），三级链332.60ms/HTTP20.18ms/另一Agent28.51ms/CPU343+109ms/loop21.79ms/byte4/project1003；工具315.96ms/HTTP18.49ms/另一Agent25.54ms/CPU375+141ms/loop69.73ms/catalog3/record14/token5/native500；2012工作台reconcile450.68/1.86ms/HTTP14.72ms/另一Agent20.21ms/loop29.25ms；7001诊断cold86.84/warm2.21ms/20阶段42.79ms/HTTP13.49ms/另一Agent20.30ms/loop76.87ms；4002提醒3.84/0.14ms/historyReads0/HTTP20.72ms/另一Agent27.27ms/loop19.66ms。另实读session-cache弱owner/WeakRef目录，不强留废弃重试候选，operation.close立即清domain；唯一artifacts/final-v01411-round40包在全新.local/consumer-final-v0.14.11-20261026普通pnpm add --offline安装，无force/安装脚本例外；8公开入口/Client factory、已安装20候选3轮比较21次完整payload序列化/精确差异、完整byte预算临界/close释放拒读/下一operation观察mutable新输入、原owned raw树/签名/invalid arguments/旧cut/独立可写plan、精确token/control batch与真实Worker全部通过，221个src/lib JS+d.ts逐字一致。SHA256=090756639639D7367D882BB359E877842B64B82F714927812CE8ED84E0A94638；包后仅补本不打包验收文档，runtime和打包文档不变。未改Harness/Worker时钟取消/预算/输入阈值，无脚本批改/Git回滚/any，未代装启用重启，goal active，同GUI和14规则现场尚未验收。

## v0.14.10：冷消息内容树一次复制（2026-10-26）

位置request-blocks.projectRequestMessage，按既有CPU热点局部读取，未重扫仓库或业务长日志。原先父raw完整子树与每个子raw重复structuredClone，使嵌套内容按祖先数重复复制。新TS ownRequestMessageBody一次复制content/source，再走原生walker，各路径raw共享自有树，由统一request-model-projection冻结后发布；没有第二缓存或跨独立preview按mutable message身份复用。parseToolArguments仍保留独立对象clone/字符串JSON解析与错误；signed/opaque/replayState/source/path/callId/$result不变，原始request/source不冻结。真实改写的完整ownedRequest独立可写、clone lineage/changed/旧cut/显式retry/close、token/Worker语义未改。

新增3单元：嵌套冷读只1content/source树+1结构化参数clone，父子raw同identity/冻结，parsed arguments独立，source仍可写、changed后旧cut不变；独立projection不借可变message；真实DataCloneError不发布、修正后显式retry。新增1真实Host用例32消息每8层嵌套，首preview32次内容clone与32完整范围改写，第二preview64次（独立own，不借可变request身份）、原生0新增读取、源和上一结果不变/可写；第三changed输入31动作，旧cut与源不变、最后统一缓存释放。定向5实质Host通过（另5空suite不计实质），原1000消息500工具证据catalog3/record14/token5/native500/pause-resume仍保持，千消息三级链project1003。

定向工具498.13ms/HTTP62.30ms/另一Agent75.26ms/两次测量preview CPU718+156ms/loop122.29ms；后CPU采样单实质Host工具556.27ms/HTTP108.16ms/另一Agent125.61ms/CPU578+312ms/loop104.33ms。profile含两次preview与额外pause/resume，projectRequestMessage40.51ms inclusive（上轮61.72ms）/modelRequestBlocks109.62ms/ownRequestMessageBody31.51ms/ownedRequest14.94ms，inclusive重叠不能相加、时点不同，整体未证明显著加速，不编百分比。必要首读复制/冻结/per-view包络/完整byte比较/Worker传输与无revision外部比较仍有成本。最终release:check strict/104JS/62事件目录、519/519单元（20388.07ms）与Host/Client构建已通过，同次完整Host工具482.23ms/HTTP44.90ms/另一Agent54.13ms/两次测量preview CPU688+110ms/loop104.33ms/catalog3/record14/token5/native500；千消息三级链467.26ms/HTTP40.83ms/另一Agent52.35ms/CPU609+78ms/loop38.70ms/project1003；2012工作台display370.80/3.46ms、reconcile558.32/2.90ms、reconcile HTTP3.58ms、HTTP27.74ms/另一Agent35.39ms/CPU812+266ms/loop42.40ms/native2012；4002提醒4.00/0.28ms/historyReads0/HTTP28.22ms/另一Agent38.99ms/CPU31+16ms/loop26.39ms。新增真实嵌套case在完整运行通过。完整源码Host218/218（252499.21ms）、Client3文件24/24（3.96s）通过。7001诊断cold161.67/warm2.60/append2.32ms/20阶段82.56ms/HTTP23.58ms/另一Agent37.84ms/CPU484+16ms/loop133.50ms/native7001；1000改写20新增无外部101.96ms/HTTP101.37ms/另一Agent112.36ms/CPU281+15ms/loop64.95ms/wire1020，fresh外部191.18ms/HTTP189.89ms/另一Agent203.51ms/CPU406+0ms/loop94.83ms/wire1540，均21帧/delta1/phase0新增native。桌面0.2.1-rc.3 ASAR隔离24/24实质/0skip/空stderr/exit0（21609.20ms），新增八层嵌套cold-copy/可写隔离通过；工具297.51ms/HTTP18.43ms/另一Agent23.21ms/两次测量preview CPU500+125ms/loop66.68ms/catalog3/record14/token5；千消息三级链307.93ms/HTTP23.27ms/另一Agent29.65ms/loop18.53ms/project1003；2012工作台reconcile438.60/1.66ms/HTTP15.08ms/另一Agent20.09ms/loop30.26ms；7001诊断cold54.95/warm2.34ms/20阶段41.73ms/HTTP11.16ms/另一Agent17.89ms/loop70.52ms；4002提醒4.20/0.22ms/historyReads0/HTTP21.58ms/另一Agent30.37ms/loop18.34ms。唯一artifacts/final-v01410-round39包在全新.local/consumer-final-v0.14.10-20261026以普通pnpm add --offline安装，无force/安装脚本例外。8公开入口/Client factory、安装态一次content/source克隆+独立参数克隆、父子raw identity/冻结、signed/invalid arguments/source可写/changed旧cut不变、模型投影/独立可写plan/close释放、精确token/control batch和真实Worker全部通过；219个src/lib JS+d.ts逐字一致。SHA256=737D0C726A6EC05E8C2C4D60775DDB944FEF616CA49272B49D9E26081C52D561。包后只补本不打包验收文档，运行时代码和打包文档未变。未改Harness/原生session-blocks库/Worker时钟取消/阈值，无脚本批改/Git回滚，未代装/启用/重启，目标active，同GUI/14规则现场尚未验收。

## v0.14.9：按owner变更戳复用同步pass精确token比较（2026-10-26）

第38轮沿已采样workbench逐证据token约45.87ms inclusive热点。新TS withPlanningToken只在单同步callback里逐证据读轻stamp，未变则复用原比较；stamp变化重读原token精确序列化，不把计数器当业务token，不因无关ACK或同revision移除恢复而误失效。stamp含store ACK/故障/close计数、session/preset、workbench来源generation、executor/detector token、control revision/epoch、templates注册/移除计数。原store.token、templates.versions及来源/disposer语义未变。失败token读不发布stamp，显式retry可继续；finally释放并禁止predicate逃逸/异步pass。workbench只planPass使用，matcher await后新pass，delivery/matcher current/最终计划仍live原token。

新增4TS guard与4JS实际owner单元：1000decision一次精确序列化、每依赖变动重读、恢复精确相等、失败retry/逃逸/异步拒绝；真实templates同版本重新注册/同步helper删除、store session/global/preset ACK、未ACK不发布/自动变量仅runtimeRevision变但token变化、故障/恢复/close与无关runtime ACK。定向16单元过。真实Host新增1条含template-remove/source-remove/template-restore三个组合：首次render同步变更后下一证据不render、stale计划拒绝，无runtime或源写；同revision恢复仍2动作。原500工具证据仅读完整token5次/catalog3/record14，500动作/250配对KEEP/独立输出/重复与pause-resume零native新增保持，千消息三级链project1003。

后CPU采样单实质Host通过（另同步失效定向1实质+5空suite不计6实质），工具plan533.05ms/HTTP112.92ms/另一Agent123.82ms/两次测量preview CPU594+250ms/loop104.99ms/token5/catalog3/record14/native500；全测试profile含额外pause/resume，token约1.60ms inclusive、轻stamp26.27ms，modelRequestBlocks116.94ms/projectRequestMessage61.72ms/full ownedRequest17.13ms。inclusive不能相加，采样/非采样时点不同，整体未证明显著提速，不编百分比；首读copy/freeze/包络、ownedRequest、完整byte与传输仍有成本。初次owner单元假设同render函数旧disposer失效错误（原行为按函数identity），只换新函数fixture；新Host初次前缀regex替换预期错误，只改为PATCHED first/second保留原后缀，失败日志保留。最终release:check的strict/104JS/62事件目录、516/516单元（21118.16ms）与Host/Client构建已通过；最终同次完整Host工具plan526.61ms/HTTP47.65ms/另一Agent64.80ms/两次测量preview CPU1172+141ms/loop122.42ms/token5/catalog3/record14/native500；pause/resume额外阶段在计时后，完整输入及500动作/250KEEP配对/重复native0新增保持。千消息三级链576.83ms/HTTP66.13ms/另一Agent80.20ms/CPU625+63ms/loop38.11ms/project1003；2012工作台display417.34/4.67ms、reconcile744.33/5.50ms、reconcile HTTP6.04ms、并发HTTP37.59ms/另一Agent45.61ms/CPU1188+218ms/loop55.02ms；4002提醒4.28/0.20ms/historyReads0/HTTP32.07ms/另一Agent43.99ms/CPU47+0ms/loop30.05ms。最终完整源码Host217/217（284748.12ms）、Client3文件24/24（4.60s）。同次7001诊断cold195.59/warm2.46/追加2.58ms、20阶段92.20ms/HTTP28.00ms/另一Agent46.43ms/CPU578+16ms/loop158.33ms/native7001；1000原生改写20新增无外部207.37ms/HTTP204.41ms/另一Agent224.58ms/CPU250+0ms/loop115.74ms/wire1020，fresh外部209.78ms/HTTP207.87ms/另一Agent218.00ms/CPU281+0ms/loop116.52ms/wire1540，21帧delta1记录/phase0新增native保持。桌面0.2.1-rc.3 ASAR隔离23/23实质、0skip、stderr空、exit0（24792.75ms），新增同步模板/来源移除及精确恢复组合通过；工具346.70ms/HTTP22.20ms/另一Agent28.34ms/两次测量preview CPU297+219ms/loop60.16ms/token5/catalog3/record14；三级链361.51ms/HTTP20.49ms/另一Agent28.54ms/loop22.69ms/project1003；2012工作台reconcile536.71/2.18ms/HTTP33.04ms/另一Agent38.48ms/loop29.10ms；7001诊断cold107.90/warm3.23ms/20阶段57.16ms/HTTP16.12ms/另一Agent25.97ms/loop107.94ms；4002提醒4.51/0.15ms/historyReads0/HTTP27.32ms/另一Agent35.09ms/loop24.97ms。唯一artifacts/final-v0149-round38包在全新.local/consumer-final-v0.14.9-20261026普通pnpm add --offline安装，无force/脚本依赖例外；8公开入口/Client factory、已安装token1000决策1序列化/同版本恢复/变量ACK/无关ACK/关闭pass、control batch、嵌套raw/投影复用与单消息改写/独立可写/close释放、真实Worker通过，src/lib217个JS+d.ts逐字一致。SHA256=6F37FE564825377B0D176EA405A04A49A02E57AA849411644FEF1D2A137C994D；包后只补本不打包验收文档，未改运行时代码或打包文档。未改Harness/Worker时钟取消预算，无脚本批改/Git回滚、未代装启用重启，整体goal active，同GUI/14规则尚未现场验收。

## v0.14.8：单同步决策批次读取控制目录与运行状态（2026-10-26）

第37轮按已知冷工具入口CPU采样，不重读真实业务长日志。既有500配对工具/1000请求消息/500命中回归原plan919.55ms、HTTP103.51ms/另一Agent111.74ms、loop551.03ms；profile包含两次preview，inclusive evaluatePlan939.68ms、planRequestV2 915.05ms、decision857.03ms、workbench decision846.22ms、controls decision634.49ms/catalog629.90ms、workbench sources228.52ms。inclusive不能相加为总耗时，loader/GC独立；第一采样因Node22不支持test-isolation=none exit9保留，使用支持参数后真实1实质通过。

原来每个命中action都controls.decision -> catalog -> provider/validate，以及record深clone、documents规范化查entry。现createRuleControls.withDecisions只在同步callback里捕获一次目录source map，借用原decisionFor继续偏好/依赖/暂停/available/storage检查；来源移除代次变化立即拒绝，finally清表禁逃逸，thenable返回拒绝。workbench规划筛选与每planPass新建batch，state每pass仅read一次，docs entry按source/rule索引。该栈内临时map不跨await/请求留存，不是第二套控制缓存；delivery仍live单次decision，每次matcher await后的planPass读新目录/state，token、历史水位、去重/冷却/生命周期保留，Date.now不被冻结。

新增2个控制批次单元验证1000decision仅1provider读，下一批偏好/暂停/依赖/available/会话隔离/移除、批内移除、storage故障与ACK retry、callback失败/逃逸/async拒绝/close。定向27单元过；原生工具/级联/工作台/预算/跨view6实质Host过（5个空suite不计实质）。工具500命中catalog3次/record14次（含并发HTTP），不随证据数重建；暂停后原请求完整不变/0动作，恢复后500动作/相同成对结果，不新增native读。采样后plan456.48ms、HTTP105.61ms/另一Agent116.19ms、loop99.81ms，profile有额外pause/resume阶段，不能编精确CPU加速比；另一未采样定向plan525.78ms/HTTP47.85ms/另一Agent58.14ms/loop121.83ms。首次正文/ownedRequest/byte比较及Worker传输仍真实成本，控制目录重建只是已测主因，不称所有生产路径已完成。最终源码同次完整Host中的工具plan493.92ms、HTTP37.00ms/另一Agent44.62ms、两次测量preview CPU672/140ms、loop110.69ms，catalog3/record14/native500；pause/resume额外阶段在计时之后且assert即时生效/零native新增。千消息三级链480.10ms/HTTP36.40ms/另一Agent49.70ms/CPU640+156ms/loop38.86ms/project1003；2012工作台display363.59/4.30ms、reconcile568.07/3.26ms、reconcile HTTP3.60ms、并发HTTP25.05ms/另一Agent34.17ms、CPU937+172ms/loop49.48ms；4002提醒collect3.66/0.23ms/historyReads0、HTTP30.81ms/另一Agent43.21ms/CPU46+16ms/loop28.61ms。审查补改每batch当前sessionTurn从统一入口读取，不沿用matcher await前snapshot；旧完整任务明确取消并收取，不计最终完整，最终源码从release开始重跑。最终release:check通过：strict/104JS/62事件目录、508/508单元（18317.96ms）、Host/Client构建；完整源码Host216/216（242629.37ms）、Client3文件24/24（3.91s），无阈值改动。桌面0.2.1-rc.3 ASAR隔离22/22实质/0skip、stderr空、exit0（19318.99ms）：工具320.08ms/HTTP19.69ms/另一Agent26.04ms/CPU297+188ms/loop80.61ms/catalog3/record14，暂停恢复仍生效；三级链312.36ms/HTTP19.45ms/另一Agent26.19ms/loop23.35ms/project1003；2012工作台reconcile401.88/1.74ms、并发HTTP30.15ms/另一Agent35.03ms/loop24.66ms；7001诊断cold63.98/warm2.34ms、20阶段43.66ms/HTTP12.54ms/另一Agent19.63ms/loop86.70ms；4002提醒3.70/0.23ms/historyReads0/HTTP20.98ms/另一Agent29.13ms/loop18.10ms。独立包用唯一artifacts/final-v0148-round37路径、新消费者.local/consumer-final-v0.14.8-20261026普通pnpm add --offline，无force/安装脚本例外：8公开入口/Client factory、安装包控制1000决策1目录/下批次偏好生效/同步移除、嵌套raw/投影复用与单消息改写/独立可写/close释放、真实Worker全部通过，src/lib215个JS+d.ts逐字一致。SHA256=F610577E41BA8EF27F35BECABBB49CB118BDB39BF0B0A5F33F41866A4C0D39A5；包后无运行时代码或打包文档变更，只在本不打包验收文档补最终结果。未改Harness/Worker时钟/取消/输入阈值，无脚本改写/Git回滚，未代装启用重启，同GUI和14规则真实时间窗尚未现场验收。

## v0.14.7：规划内模型正文复用与实际视图依赖（2026-10-26）

第36轮沿request-blocks.modelRequestBlocks和workbench显式cascade局部处理，未重扫业务长日志。旧实现每次完整遍历并clone各块raw/source/parse参数；现正文与每视图envelope分离，TS request-model-projection由既有createRequestPlanCache纳入Host统一SessionCache，弱message身份复用冻结的自有正文。规划器完整复制前后消息可明确继承已构建正文；在文本/参数/filter写入前只失效该message，system按文本失效。ID/requestId/messageIndex/native origin/turn继续每视图建立；不把不同view位置缓存进正文。真正变更请求仍full ownedRequest独立可写，写入的raw再复制，缓存不能冻结源请求或污染旧cut。close清域并拒绝重建，部分project失败可显式retry。

同路径发现cascade始终originalSessionBlocks，即使剩余规则只选择model；原生历史正文被无用展开后还进入Worker传输。现按remaining的选择及动作target实际view依赖读取，没有截断生产历史/修改Harness/放宽Worker计时或输入上限。额外复查发现original选择可注入model，故初始及cascade都合并select.view与action.target.view；跨view原生回归保留原始证据到模型锚点再到下一次级联。单次生成千条消息真实三级链先因4MiB输入上限正确失败；最终保留1000消息全请求，生成正文256字符（原样本1024），规则显式depth1，未以失败样本宣称通过。另一次失败为测试错误要求原生createMessage可写，原生本就冻结；现比较输入原冻结状态，仍要求结果独立可写。两个失败日志保留。

严格类型和20项定向请求回归通过；其中7项新增覆盖1000消息2KB正文十次不变/clone身份/仅一条编辑重建/旧cut/system/重排/来源/requestId，嵌套tool-result/签名/解析错误、partial-failure/close后拒绝重建，实际replace/tool-arguments/成对filter/预算排除重规划。真实Host千消息三级级联bodyProjections恰1003（1000输入+system+两个已检查注入），应用3项，返回1003消息，输入及原冻结状态不变，结果独立可写；nativeReads1000、snapshotEvents/deriveMessages0、所有request-plan/model缓存释放。最终定向观测plan460.25ms、鉴权HTTP90.21ms/另一Agent107.93ms、CPU813/47ms、loop30.44ms；该样本在去除无依赖original展开前曾约35秒但在原生冻结断言处失败，没有把失败计为通过或直接用不完整时点作精确加速比。

最终同代码完整release:check通过：strict/104JS/62事件目录、506/506单元（17506.71ms）、Host/Client构建；完整源码Host216/216（243128.40ms）、Client3文件24/24（4.04s）。在最后跨view修复前启动的完整任务已kill并收取，不计最终结果；最终任务从定向跨view、release到完整Host/Client串行重跑，未放宽阈值或修改Harness。

同次最终Host：千消息三级链project1003，plan499.15ms、HTTP33.71ms/另一Agent46.53ms、CPU547/125ms、loop32.67ms；500配对工具/1000请求消息过滤909.46ms、HTTP43.51ms/另一Agent55.55ms、两次预览CPU1828/125ms、loop553.65ms，后者冷路径仍明显阻塞，不据前者改善称全修。2012工作台display354.62/3.25ms、reconcile566.74/3.01ms、HTTP29.22ms/另一Agent37.48ms、reconcile HTTP3.63ms、CPU922/172ms、loop46.83ms；7001诊断cold155.03/warm3.27/追加2.46ms、20阶段96.19ms、阶段HTTP24.52ms/另一Agent39.34ms、CPU516/47ms、loop130.48ms；4002提醒collect4.45/0.19ms、historyReads0、HTTP25.23ms/另一Agent33.81ms、CPU47/0ms、loop23.64ms。改写无外部20新增105.54ms/HTTP104.22ms/另一Agent113.10ms/CPU156+15ms/loop72.55ms/wire1020；外部fresh500为207.67ms/HTTP204.23ms/另一Agent215.27ms/CPU266+16ms/loop108.13ms/wire1540，21帧且每delta仅1记录、阶段零新增native读。

桌面0.2.1-rc.3 ASAR隔离22/22实质、0skip、stderr空、exit0（20180.88ms）；新增千消息三级链341.78ms、HTTP19.87ms/另一Agent26.65ms、CPU375/109ms、loop27.66ms/project1003；工具过滤537.65ms/loop283.90ms；工作台reconcile451.46/2.56ms，7001诊断20阶段40.41ms/HTTP10.89ms/另一Agent18.72ms、loop79.82ms。包括原生取消/旧cut/内容更新及新增跨view锚点，没有代装插件。最终包用唯一artifacts/final-v0147-round36路径及全新.local/consumer-final-v0.14.7-20261026普通pnpm add --offline安装，无脚本/依赖例外；8个公开入口、Client factory、嵌套raw块、已安装model投影复用/单消息改写/结果独立可写/close全域释放及真实Worker通过，src/lib共215个JS/d.ts逐字一致。SHA256与提交/tag/独立远端核验写持久记录，包之后源码无变化。尚有首次正文构造/每视图envelope遍历、实际变更full-copy/完整byte比较/Worker JSON传输及无revision外部查询比较成本；不将本次计数证明写成所有未知路径完成。同GUI实际加载/CPU/loop/鉴权HTTP/另一Agent、14思源规则原生接纳/最终投递/去重仍需哥哥安装后现场，真实时间窗不伪造；未代装启用重启。

## v0.14.6：请求规划的工具组与删除祖先索引（2026-10-26）

第35轮从request-blocks到实际workbench plan发现：每个工具过滤action都blocks.filter完整块列表，多个子块命中同call还会重复校验/添加整组；每个删除块blocks.some重扫全表寻找已删祖先。现TypeScript纯索引按输入顺序保留模型块、ID和跨view工具组；既有createRequestPlanCache将不可变数组索引纳入Host统一SessionCache，在同操作及预算重规划复用，finally close同时释放分析和块索引。相同call只校验/加入一次，仍保留每个命中的动作记录；删除祖先以同messageIndex和完整路径组件查询，排除$result包装，不改变深层/从右到左顺序。

实际变更请求仍独立可写，clone/byte比较/匹配/初始模型块投影仍有成本。曾尝试只复制受改消息但读到既有独立可写结果测试后立即撤回，未把共享可写消息作为优化；请求规划取消、工具配对、签名/opaque拒绝、注入/缓存预算和完整diff语义保留。没有另建模块全局缓存/业务账本或改Harness。

定向strict/104JS和13项规划/预算单元通过。4000块读一次后20次复用不再读callId，close无索引残留；500同调用子块的生产过滤读取有线性计数上限，配对/嵌套/signed拒绝及独立副本均过。真实Host的长工具过滤使用完整workbench.preview和真实Session，500事件、1000请求消息、500命中子块，删除250完整工具组而保留250组；再预览结果相同、零新增native reads、snapshotEvents和deriveMessages均0、所有规划缓存已释放。外部服务/原生Session不mock。

定向Host：工具过滤895.72ms，鉴权HTTP96.42ms/另一Agent105.49ms；含两次预览的CPU1765/93ms、event-loop max536.35ms，nativeReads500。长工作台2012事件display351.58/4.14ms、reconcile593.92/2.94ms，HTTP31.98ms/另一Agent40.38ms、reconcile HTTP4.04ms，CPU1000/250ms、loop41.09ms。2项实质用例通过（命名筛选额外5个空suite wrapper不计实质数）。桌面0.2.1-rc.3 ASAR隔离20/20实质/0skip、stderr空、exit0，含新工具过滤/工作台/共享原生读取/诊断/提醒/改写；工具过滤753.73ms、HTTP73.28ms/另一Agent81.74ms、CPU1250/187ms、loop388.50ms。完整发布首次单元detectors优先级用例报matcher-work-timeout（exit1），不计通过；原阈值独立detectors13/13已过，但不能凭同时桌面运行就断言失败根因。未改任何超时/取消/断言，随后完整release:check通过：strict/104JS/62事件目录、单元499/499（18269.96ms）及Host/Client构建；完整源码Host214/214（241260.73ms）、Client3文件24/24（4.30s）退出0，全部为最后代码；新独立消费者普通离线安装通过，公开入口/Client factory/嵌套改写/原始块/真实Worker和已安装块索引跨view配对/不变复用/close无残留通过，src/lib共213个JS及d.ts逐字一致。最终文档包另用唯一final2路径与全新消费者复核，哈希与commit/tag/远端结果写持久记录，避免同路径pnpm缓存冒充新包。

最终完整Host214/214同次性能：工具过滤862.06ms、HTTP46.50ms/另一Agent55.30ms、两次预览CPU1453/94ms、loop526.12ms；2012事件工作台display418.02/2.99ms、reconcile539.09/2.86ms、HTTP51.12ms/另一Agent60.39ms、reconcile HTTP3.23ms、CPU1078/203ms、loop40.04ms；7001诊断cold140.35/warm2.47/追加2.36ms、20阶段82.24ms、阶段HTTP24.97ms/另一Agent38.50ms、CPU485/16ms、loop149.68ms；4002提醒collect4.94/0.20ms、historyReads0、HTTP25.83ms/另一Agent35.89ms、CPU47/0ms、loop23.97ms。同次改写无索引20新增101.11ms/HTTP98.10ms/另一Agent108.72ms、CPU219/0ms、loop74.32ms，wire1020；fresh外部索引185.23ms/HTTP183.74ms/另一Agent195.13ms、CPU297/0ms、loop103.74ms，wire1540；当前工具命中34.21ms/HTTP3.43ms/CPU94/0ms/loop11.23ms。所有stream仍21帧、每delta1条、阶段零新增原生日志读取。这些是生成原生事件的隔离观测；工具规划仍有约半秒的最大事件循环延迟，不能仅以低于宽回归上限称作完全解决。

本轮只对定位到的两处嵌套扫描交付，不宣称初始模型块构造、实际请求变更或所有未知路径已清完；同GUI实际加载/CPU/loop/鉴权HTTP/其它Agent与14规则仍需哥哥安装后现场验收，不能用生成原生事件或401替代。

## v0.14.5：wire缓存归属与外部修订复用（2026-10-26）

第34轮核查实际旧服务dsh-better-session-query的lib/index.js:769-784和lib/store.js:484-516：属性put/list/remove没有revision或变更通知；块索引generation不是属性修订；list默认返回最新500条。因此不能安全以Session版本或块generation跳过属性读取，不修改提供者、不假定外部不再更新或撤销。

v0.14.4仍有两个具体漏项。rewrite-wire虽然使用统一缓存，却以每个source row为owner；journal或外部数组仍持有这些对象时，release(Session)不能释放它们。另一个是外部list每次返回新对象时仍重复JSON parse、Zod校验和wire重建。现原生Session同时持有rewrite-view和rewrite-wire；后者弱持有不可变源身份，仅强持有当前外部响应的wire修订，外部撤销条目从复用表移除。统一Session release即使源数组仍存活也能清除两个域，后读按原事实重建。无模块全局注册表、无额外业务账本，不改原生事件或投递语义。

对无revision的外部结果仍按实际字节比较；不依赖其对象identity，原地修改和新对象修订都可见。已返回相同wire的正文不再parse/validate/重新规范化，同哈希多个旧修订也各自复用；Host有界维护诊断与本地journal相同已ACK wire值共用candidate。原生来源优先和时间顺序不变、失败仍显式传播/可重试。外部查询、JSON序列化比较及可选提供者自身的JSON解析仍有成本，本轮不是把它们包装成恒定时间或零扫描。

新增500条外部正文及同哈希旧修订单元，验证fresh对象重复读取、原地变化、撤销、Session释放与重建；真实Host再用1000条2KB正文验证十次不变读无新归一化、单条变化、旧公开数组、release后全部rewrite域entries0及零原生历史读取。实际注册writer到Host journal/鉴权stream/客户端投影新增有无旧索引两种压力；旧索引使用按实际提供者行为返回fresh JSON且最新500条的服务fixture，只替代外部索引，不mock原生Harness，也不声称加载了实际索引SQLite插件。

新增计数最初发现冷读1001/1501而非1000/1500；定位request-cache.put规范化生成Host副本，修复相同wire共用后原断言通过，未放宽阈值。此前完整任务pwsh-d033a89b0c374871被明确取消、收取killed，不计为最终通过；最终源码重新执行全部发布门禁。

最终release:check退出0，单元495/495（17652.17ms）、104JS语法、strict、62事件目录及Host/Client构建通过；完整源码Host213/213（240163.28ms），客户端3文件24/24。全部基于最后Host副本复用修复后的相同源码，无后续未验收代码调整。桌面0.2.1-rc.3 ASAR隔离20/20实质测试、stderr空、exit0，包括新增external生命周期回归、有/无索引writer/鉴权流、原生缓存/校准及长诊断。桌面20次新增无索引94.69ms、HTTP95.41ms/另一Agent108.54ms、CPU266/0ms、loop81.00ms；有索引108.59ms、HTTP108.30ms/另一Agent115.10ms、CPU172/0ms、loop65.77ms。wireNormalizations分别1020和1540：首读1000/1500，加20条本地或两来源40条新增，每delta恰1记录、总21帧，阶段无原生历史重读。

最终源码同次整体观测如下，不以单个matcher、401或桌面定向通过替代；完整Host/Client退出和包指纹单独收取。

| 场景 | 冷 / 重复 / 增量 | 并发鉴权HTTP / 另一Agent | CPU user/system；loop max |
|---|---|---|---|
| 1000事件+1000改写，无外部索引 | 首读37.17ms；20新增104.85ms；wire总1020 | 103.62 / 112.42ms | 125/63ms；66.52ms |
| 相同写入链，外部fresh最新500行 | 首读36.58ms；20新增182.38ms；wire总1540 | 180.23 / 188.38ms | 250/0ms；94.63ms |
| 7001事件诊断页 | 冷158.98 / warm2.83 / 追加2.49ms；结算28.11ms；20阶段87.30ms | 冷158.67/166.95ms；阶段25.70/40.83ms | 532/0ms；134.87ms |
| 2012事件工作台 | display383.73/3.46ms；reconcile579.12/4.03ms | display32.58/41.49ms；reconcile HTTP5.55ms | 844/266ms；53.25ms |
| 4002事件提醒 | collect5.91/0.58ms，historyReads0 | 28.28/45.38ms | 188/0ms；24.37ms |
| 当前工具命中与原生去重 | 81.94ms | HTTP71.15ms | 156/0ms；75.96ms |

最终包使用新的tgz路径与全新消费者普通离线安装，运行入口/Client factory/嵌套改写/原始块/真实Worker并逐字比较src/lib运行时及声明；结果和哈希记在持久记录，不复用旧file路径缓存冒充一致性。所有性能事件为隔离生成原生会话，未重新解码业务长日志。磁盘desktop插件manifest仍0.13.9，不代表进程加载状态；没有安装/启用/重启或借401冒充响应。哥哥安装后的实际版本、同GUI CPU/loop/鉴权HTTP/其它Agent与14条规则原生接纳/最终投递/去重仍待现场，真实时间窗不伪造。整体goal继续active，本轮两个具体漏项交付不等于所有未知生产路径清完。

## v0.14.4：改写订阅增量与共享 wire 投影（2026-10-26）

第33轮沿生产改写订阅读者发现：index.js 的 durable.list 仍取完整 contextCareRequests.list 后过滤；rewrite-journal 每次重新遍历全部进程内记录并合并排序；change-route 对每个订阅读者 clone/parse/stringify 全表再逐行 stringify 比较。v0.14.3 的动作/提示增量断言没有覆盖此路径，本轮修复不据前次通过推断所有消费者完成。

现读取有界维护诊断中的实际改写，不初始化原生结算目录。统一 Host 缓存按原生 Session 身份持有 rewrite-view 和 rewrite-wire，追加游标只处理新本地事实，旧不可变正文复用一次归一化。生产订阅使用现有弱游标合并 feed，首读共享当前原子切面，后续仅发送增删/最新修订；删除旧完整深比较分支，没有备用旧分支、轮询、新持久业务账本或旧触发补跑。显式 HTTP 全列表仍可物化所有改写，保持来源最新时间优先、durable/index/local 同时间顺序与会话隔离；旧公开列表数组保留。

旧外部属性表没有修订或失效通知契约，不能安全永久缓存；仍按会话实际读取、比较该后端返回值，保留晚到新增、更新和撤销，不把这一边界谎称零扫描。并发只合并在途 I/O，完成结果不放第二个注册表。统一缓存 release 后按原事实重建；部分构建失败丢弃投影后显式重试；关闭后在途读/写不能重新生成本地索引。原持久 ACK 失败不发布成功改写，哈希仍只是内容关联线索。

### 最终门禁与整体观测

完整 release:check 退出0：严格类型、104JS语法、原生事件目录、运行时独立性、Host/Client构建通过；最终单元494/494，完整源码Host211/211（256673.50ms）、客户端3文件24/24。完整门禁开始后追加了同时间排序/共享显式切面与首读原子性收尾，最终源码再次严格check，22项改写/客户端单元以及下表6项实质原生/性能回归通过；另5空wrapper不计。千条原生改写测试禁止完整list/view，断言不变读不重建wire、20修订每次1增1删、慢读者合并、旧公开数组、release及失败恢复。实际鉴权生产stream也在完整list/view抛错条件下正常。

真实注册的 requestRewrite 回调驱动1000条改写及20条新增，经过实际控制、Host journal、鉴权stream和客户端投影，不以手动注入记录替代写入。首版fixture只有Session无live Agent，真实控制正确拒绝执行；改为agentLoop.create并确认clean已启用后原断言通过，没有绕开门或放宽断言。测试Context插件类型及fetch输入起初过窄，已改用既有fixture边界修正。最终源码日志为 .local/notes/final-perf-v0144-round33.log，数据均生成的原生Session事件，未重新读取或解码业务长日志。

| 场景 | 冷 / 重复 / 增量 | 并发鉴权 HTTP / 另一 Agent | CPU user/system；loop max |
|---|---|---|---|
| 1000原生事件+1000改写订阅 | 首读85.61ms；20新增159.21ms；总21帧，每delta恰1条 | 158.26 / 181.88ms | 485/0ms；133.82ms |
| 7001事件提示页 | 冷140.71 / warm3.27 / 追加3.80ms；千条结算页34.08ms | 冷140.22 / 148.59ms | 625/32ms；150.21ms |
| 同会话20次诊断阶段 | 合计88.95ms；已有结算零重解析、reads仍7001 | 29.76 / 45.35ms | 计入同次提示页测量 |
| 2012事件工作台 | display358.92/4.60ms；12新消息reconcile568.63/2.98ms | display34.98/43.90ms；reconcile HTTP6.03ms | 968/203ms；40.80ms |
| 4002事件提醒 | collect6.20/0.16ms；historyReads0 | 30.91 / 41.69ms | 63/0ms；30.45ms |
| 当前工具命中及原生去重 | 46.85ms | HTTP5.67ms | 78/0ms；18.49ms |

桌面0.2.1-rc.3 ASAR隔离Electron Node19/19实质通过、stderr空；包含新增原生改写、真实writer压力和鉴权stream。桌面改写首读65.28ms、20变化89.67ms、HTTP90.21ms/另一Agent103.19ms、CPU265/0ms、loop65.47ms；7001诊断阶段79.99ms、阶段HTTP17.11ms/另一Agent28.29ms。首读原子分支最终再执行3项桌面改写/stream回归，实际输出另存desktop-final-v0144-round33日志。独立解包导出/Client factory/相对运行时闭包已通过，最终文档后使用新tgz路径和全新消费者普通离线安装再逐字核对，发布指纹写入本地和思源记录；不复用旧本地file依赖缓存充当最终一致性。

2026-10-26 05:40+08:00只读desktop磁盘manifest仍0.13.9，不推断进程实际加载状态。未安装、启用或重启；已有GUI先前401不计性能证据。哥哥安装v0.14.4后，实际加载版本、同GUI整体CPU/事件循环/鉴权HTTP/其它Agent和14条规则逐项原生接纳、最终投递、重复去重仍未验收，自然窗口按真实时钟；整体goal继续active，不将当前隔离结果称为全部目标完成。

## v0.14.3：实时诊断精确变化流（2026-10-26）

第32轮核查实际实时阶段更新，发现 v0.14.2 的 listOne 虽能复用不变列表，每个诊断 revision 仍会 map 全部结算、重建事件/事务集合并 sort；提示五类关系和动作归属/审计/准入继续多次遍历全部记录。原有不变切面断言不足以证明这条变化路径已增量化。现由统一 Host Session 缓存按新结算游标、事件和事务索引只更新新增或实际受影响的公开记录，生产 carePages 的动作/提示 HTTP 与推送改为消费同一个变化流，不获取完整 view。

变化流按独立弱游标合并尚未消费的同一记录修订，慢读者不保留所有阶段版本；首次读者共享稳定冷切面。关系桶只增删变化记录，动作只重新归属实际受影响事务、重建变化分组的审计标量及有序准入候选，空分组桶删除。公开 list/view 仍按需返回新快照且旧切面不变；Session 原生结算优先，不新增持久业务账本、定时轮询或旧触发发现。弱游标属于同一 Host 所有的诊断缓存，不是平行的 Session 事实缓存。首次全历史建索引及显式完整列表的构造仍有必要成本，数组有序插入可能移动引用，不能宣称所有成本为常数。

新增真实 Host 回归用1000条原生结算并禁止再次迭代历史请求数组，验证实时阶段只传递增删/最新修订、只新结算或受影响证据重建、慢读者合并、release、旧快照及页面部分更新失败重建。原生动作回归覆盖晚到归属及撤销、准入阶段更新/移除和旧页不变。实际鉴权 Host 路由把完整 view 改为抛错探针，动作/提示分页仍200且 view 调用为0。单元另覆盖首次切面跨读者身份共享、关系千条只解析新增、初次/增量排序失败不丢待消费变化。旧显式数组顺序最初因新排序出现2项动作回归失败，已恢复原阶段顺序并验证；长压力第二次 Agent 探针最初耗尽测试响应，已补足真实请求所需响应并重跑，未放宽断言。

### 最终整体压力观测

以下是当前源码的实际 Loader/Session/Worker/鉴权 HTTP 与另一 Agent 并发单次观测；数据为生成的原生事件，没有再次读取或解码业务长日志。隔离结果不替代运行中已安装 GUI 的性能保证。

| 场景 | 冷 / 重复 / 增量 | 并发鉴权 HTTP / 另一 Agent | CPU user/system；loop max |
|---|---|---|---|
| 7001事件提示页（6001提示+1000结算） | 冷218.87 / 重复7.20 / 追加6.76ms；千条新结算页33.10ms | 冷213.67 / 229.72ms | 1157/62ms；202.64ms |
| 同会话20次实时诊断变化 | 合计156.65ms；已有结算零重解析、原生读取仍7001 | 47.50 / 71.99ms | 计入同次提示页测量 |
| 2012事件工作台 | display413.15/6.50ms；12条新消息reconcile644.54/3.06ms | display46.14/57.46ms；reconcile HTTP6.47ms | 1313/234ms；41.88ms |
| 4002事件提醒 | collect18.05/0.30ms；historyReads=0 | 113.19 / 132.89ms | 141/0ms；95.40ms |
| 当前工具命中及原生去重 | 65.37ms | HTTP10.57ms | 93/0ms；27.40ms |
| 350结算/700事件完整请求目录 | 冷20.48ms；20次重复合计1.66ms；route0.37ms；无匹配校准0.26ms | 5轮HTTP2.97–11.58ms；无关请求3.38–12.09ms | 查询47ms；next turn24.21ms |

桌面0.2.1-rc.3 ASAR原生包隔离Electron Node实际输出16/16实质通过，stderr空，含千条诊断变化及晚到归属撤销。桌面7001事件页冷140.80ms、warm4.54ms、追加5.38ms，千条结算页23.20ms；20次阶段144.25ms，阶段HTTP29.83ms/另一Agent40.03ms，CPU625/15ms、loop195.56ms，原生读取7001。直接GUI子系统exe首个调用只有exit0无stdout，未据此计为通过；随后显式重定向完整stdout及退出码才计入。未安装、启用或重启桌面。

完整 `pnpm release:check` 退出0：严格类型/104JS语法/原生事件目录/运行时独立性、490/490单元、Host/Client构建通过。完整源码Host209/209（285253.58ms）、客户端3文件24/24通过；当前源码空桶清理后再次类型、18项动作/提示/关系单元及3项实质原生接线/增量回归通过，另外5空wrapper不计。新tgz解包导出/Client factory/运行时闭包、独立目录普通离线pnpm安装的公开入口/声明/嵌套改写/原始块不变性/实际Worker通过。最终文档及源码收尾后重新打包并核对消费者全部运行时字节。首次复用同一路径tgz执行pnpm add --force后入口冒烟成功，但逐字核对发现消费者仍是旧缓存、缺少最后空审计桶删除；该次不计最终一致性。改用新的tgz路径和全新消费者普通离线安装，重新执行冒烟及字节核对；发布指纹写入本地及思源进度。

2026-10-26 05:02+08:00只读磁盘desktop插件manifest仍0.13.9；这只证明磁盘清单，不推断进程加载状态。前轮现有GUI在浏览器上下文返回401，未取凭据，本轮不把它计作性能。哥哥安装v0.14.3后仍须核对实际加载版本、同GUI CPU/事件循环/鉴权HTTP与其它Agent响应，以及14条思源规则逐项触发、原生接纳、最终投递与重复去重；自然时间窗按真实时钟。整体goal保持active，旧v0.14.0/v0.14.1/v0.14.2标签不覆盖。

## v0.14.2：交错工具目录测量复用（2026-10-26）

第31轮继续自查发现 v0.14.1 的校准候选索引虽然区分完整表头，成功测量却只在同一 Session／测量函数下保留单槽。相同配置的工具目录A→B→A查询会淘汰A，重新构造历史Session并计价。新真实Host回归在旧实现先失败：A原textTokens=1，重查变为3；不能以先前单目录回归通过宣称这条路径完备。

现由同一Host缓存域在测量函数弱键下，按实际有匹配样本的完整表头分别保留最新成功测量和当前能力依赖。无匹配查询不进入测量缓存，新增结算仅替换其自身表头的样本，某一表头的能力变化不淘汰其它目录。依然按确切原生Session释放，不增加持久业务表或私有生命周期。回归覆盖两个facade交错访问、不变切面零原生取数／零历史重放、同配置不同工具目录与负查询、追加A结算只更新A、各目录能力独立失效。原有失败重试、disposal与操作计价定向回归4项实质通过（另5空wrapper不计）。

本次完整门禁的真实长工作台用例使用2012个生成原生事件：冷display393.95ms、重复5.12ms，12条新增消息reconcile602.38ms、重复3.17ms；display并发鉴权HTTP35.69ms／另一Agent44.56ms，reconcile并发HTTP5.78ms，CPU user1016ms/system203ms，loop最大41.19ms，所有消费者原生读取2012。6001事件诊断页冷147.86ms、重复6.65ms、追加2.44ms，并发HTTP147.24ms／另一Agent156.29ms，CPU422/0ms、loop126.48ms、原生读取6001。4002事件提醒collect5.32ms、重复0.20ms、historyReads=0，并发HTTP27.30ms／另一Agent36.05ms，CPU47/0ms、loop24.33ms；当前工具命中37.28ms、HTTP4.90ms、CPU78/0ms、loop11.70ms。均为隔离实际Host／Worker生成数据的单次观测，没有再次读取业务长日志，不代表已安装GUI性能。

同次完整源码Host的大工具目录请求查询（350结算／700事件）冷列表17.97ms、20次重复合计0.84ms、previousRoute0.11ms、无匹配校准0.42ms；5轮并发鉴权HTTP3.56–15.64ms、无关请求4.42–16.30ms，查询CPU16ms、next turn20.39ms。

桌面0.2.1-rc.3 ASAR原生包隔离Electron Node进程15/15通过，包含新增交错目录用例；大目录冷列表28.19ms、20次重复合计1.19ms、HTTP2.70–13.35ms。公开原生包不改写、测试tsx只用于装载测试TypeScript。最终`pnpm release:check`退出0，严格类型／104个JS语法／原生事件目录／运行时独立性、487/487单元及Host／Client构建通过；完整源码Host208/208（237471.79ms）、客户端3文件24/24通过。修正版tgz导出／Client factory／运行时闭包通过；独立目录普通离线pnpm安装0.14.2后，公开入口／声明／嵌套改写／原始块不可变性及实际匹配Worker通过。最终src／lib156个JS与测试消费者逐字一致；最终文档变更后重新打包并核对。

现场核查：磁盘desktop插件仍为0.13.9，当前63862 GUI在本浏览器上下文返回401且snapshot明确要求认证。本次不取凭据、不自动安装或重启；401不计作鉴权性能，也不据磁盘清单推断当前加载状态。思源14条规则逐项现场触发／原生接纳／最终投递／重复去重和自然时间窗仍未验收。旧v0.14.0／v0.14.1标签不覆盖。

## v0.14.1：统一缓存与增量投影（2026-10-26）

此前两个阶段的代码余项已在本版本继续处理，以下为当前交付依据；旧阶段记录保留当时状态，不代表仍有相同生产旁路。全部生产事件读取、原生消息解释与工具历史入口收敛到 `session-log.ts`，废弃 `snapshotEvents` 零调用。Host 所有的 `cache` 管理器以确切原生 Session/不可变 observation 为 owner，集中管理命名域、依赖、失效、disposal、关闭及命中/工作量报告。剩余消费者弱表用于在途请求、串行维护、预约或服务启动，不另存可重建日志事实；管理器内部的弱键用于随所有者回收。

共享域覆盖事件/类型/范围索引、surface 消息/类型/原始块/来源、请求历史/校准、完成/输出反馈、工作台窗口、提案、提醒身份/交接/接纳/额度游标和诊断页面。增长只处理新增事实，替换与内容 generation 保留原生时序。显式工具结果重试复用向前上下文和最近更早切面；拒绝证据及回执按序号受锚点约束。失败、取消、解释器卸载、迭代中途失败及同 ID 对象替换均有真实 Host 回归；失败 consumer 丢弃重建，旧切面保持不变。

维护候选线性累计标量，最终选择或实际尝试才展开选区；2000节点回归约束事件读取为线性且比较项无重叠前缀数组。诊断先分页元数据再构造正文，1000条测试首次只物化20条，重复页复用；6000条压力用例所有读者合计只取6001个原生事件。列表不为校准预先 hash 所有大工具目录，实际配置的候选按查询惰性索引。曾测得的350个结算冷列表304.96ms由该重复目录处理引起；修正定向测试为23.44ms，最终全量下为35.28ms。计价捕获只预热共享文件附件投影，路径相关 file 文本每次操作冻结，避免给整段文本/图片重复计价。

### 隔离真实 Host 性能

使用实际 Loader、Session、Worker、JSONL 与鉴权 HTTP，并与另一 Agent 同时运行；数据为生成的原生事件，没有再次解码业务长日志。数字为单次观测，不作为稳定延迟保证。

| 场景 | 冷 / 重复 / 增量 | 并发 HTTP / 另一 Agent | CPU user/system；loop max |
|---|---|---|---|
| 最终6001事件提示页 | 146.70 / 2.94 / 4.51ms | 146.11 / 155.06ms | 157/78ms；117.77ms |
| 2012事件工作台（末轮优化前同功能回归） | display418.15/6.12ms；12条新消息reconcile657.94/6.68ms | display42.98/54.14ms；reconcile HTTP6.27ms | 1078/219ms；55.74ms |
| 最终4002事件提醒收集 | 5.49 / 0.22ms；historyReads=0 | 31.07 / 40.81ms | 78/0ms；28.61ms |
| 最终当前工具命中和原生去重 | 32.85ms | HTTP4.40ms | 79/0ms；11.76ms |
| 最终350个结算/700事件请求查询 | 列表35.28ms；20次重复合计1.51ms；route0.27ms；无匹配校准0.31ms | 5轮HTTP4.60–21.49ms；无关请求5.30–22.78ms | 查询16ms；next turn39.24ms |

工作台曾发生的50853.6ms历史自动display补算已通过准入水位与增量共享消除；首次构造相关索引仍有实际成本。冷 observation 内部完整数组物化属于原生公开读取成本；lifetime共享额度、sticky/窗口和冻结inbox恢复仍读取所需原生事实，不任意截断，不重置计数，也不补跑历史规则。

### 发布门禁

- `pnpm release:check` 退出0：严格类型、104个JS语法、事件目录一致性、运行时独立性检查、487/487单元及Host/Client构建通过。
- 最新完整源码Host207/207、客户端3文件24/24通过。另有9项实质定向Host回归通过（runner5个空文件包装不计）。
- 桌面`0.2.1-rc.3` ASAR原生包隔离Electron Node进程14/14通过：共享读取/旧切面、历史解释失败/取消/卸载、校准、同ID重建、锚定回执、当前提醒命中及大目录查询；当前命中43.62ms/并发HTTP7.11ms，大目录冷列表30.96ms。使用已有tsx加载测试TypeScript，不替换宿主代码，不启动替代GUI。
- 发行tgz解包核对公开Host/提醒/声明导出、Client factory及src/lib运行时相对依赖通过；独立测试目录普通离线pnpm安装后，入口、声明、嵌套改写、原始块不可变性和实际匹配Worker通过，未链接开发依赖。pnpm报告registry依赖均重用，tgz作为本地包计入downloaded1。
- 新增回执测试曾因接口名误写而在类型检查失败；打包和消费者扫描曾把JSDoc类型路径误判为运行时导入，均已按真实接口/编译后代码修正后重跑通过。未将这些失败计为通过。

源码、构建产物和文档按新版本提交/tag推送，旧标签不覆盖；安装由哥哥执行，不自动安装或重启。**安装后同一GUI的实际加载版本、鉴权HTTP/事件循环，以及思源14条规则逐条触发、原生接纳/最终投递与重复去重仍未验收。** 自然时间窗按真实时钟，不改系统钟；隔离测试不能代替现场结果。

## 阶段记录：分页与快照调用清理（2026-10-25）

动作/提示共用 Session 元数据索引，HTTP 和 changes 推送从同一索引选页；测试中1000条提示首次仅物化20条正文，重复页复用，历史定位不重新读原生事件，单条追加只读一个新事件。迟到事务归属、记录顺序、未来证据和投影失败均有回归；失败的部分索引丢弃后从已缓存事实重建，不发布不完整状态。请求历史与完成提示按类型/游标增量读取，校准复用原生历史切面和不可变事件。

6000条、每条约4KiB提示的真实 Loader/Session/鉴权HTTP 与另一 Agent 并发用例，最新实测冷页219.10ms、重复页3.93ms、按序号定位5.15ms、单条追加5.02ms；并发HTTP212.62ms、另一Agent229.12ms，CPU user375ms/system15ms，事件循环最大延迟126.81ms。所有读者合计只取6001个原生事件；该隔离生成数据不证明已安装GUI或14条规则已经验收。

生产源码 `snapshotEvents` 零调用，`pnpm check` 检查全部 JS/TS 源文件并拒绝该符号回流；测试文件仅保留原生输出观察/计数用途。全历史重建改为显式异步 `all()`，由原生 observation 读取，切面内共享结果与独立取消；无生产调用方的工具触发 `recover`、专用创建标记和投递 `observeLog` 已删除。原生 observation 内部仍物化全历史数组，且统一入口与其它消费者还有 `eventAt`；这不是全部同步历史访问迁移完成。显式工具结果上下文前缀重放、首次display、其它恢复/投影路径仍是代码侧余项，不归为安装依赖。

本阶段检查：生产构建与严格类型通过；单元483/483、定向实质Host24项通过（runner另4个空包装不计）；新增异步取消和部分更新失败回归还需执行。尚未发布新版本或安装运行态。

## 阶段记录：工作台读取与投影清理（2026-10-25）

工作台 reconcile 使用统一 Session 类型/范围索引；原始块与模型消息来源共用 Host 所有的 surface 投影缓存，原始块维持时间顺序，模型消息维持原生替换位置及 contentGeneration 语义。display 的原始历史投影按游标追加；depth 以角色/类型筛选前的 block/message/turn 身份计数，重复切面不重新解析历史，旧切面不受新尾部污染。通知/任务规划无请求修改时复用输入，只有真正改写时才复制；同一 reconcile 请求只测量一次不变字节量，级联保留已有精确测量。

新增真实 Loader/Session/Worker/鉴权 HTTP/另一 Agent 用例使用生成的 2012 条原生事件，没有读取业务长日志。首测虽没有秒级 HTTP 阻塞，但 reconcile 仍耗时 50,853.6ms，CPU user40,047ms/system9,640ms；原因是自动 display 对规则准入前的 2000 条消息逐条补算。现将既有规则准入水位用于自动扫描起点，手动历史 detail 仍按当前规则渲染，不补触发历史动作。回归断言只对 12 条新增消息执行自动显示，重复 reconcile 无新增原生读取或动作。

| 指标 | 修正后 |
|---|---:|
| 冷 display / 重复 display | 392.56 / 4.93ms |
| 12 条新增消息 reconcile / 重复 reconcile | 609.19 / 2.98ms |
| 冷 display 并发鉴权 HTTP / 另一 Agent | 81.11 / 88.55ms |
| reconcile 并发鉴权 HTTP | 7.61ms |
| 并行阶段 CPU user / system | 1203 / 266ms |
| 事件循环最大延迟 | 43.06ms |

工作量断言同时覆盖零完整 snapshotEvents/deriveMessages 旁路、相同 cut 快照身份共享、原始块只处理新事件、替换后顺序、旧切面、冷 observation/取消，以及当前消息的完整显示正文。首次 display 仍需构建相关历史块索引；该用例不是运行中桌面 GUI 的 A/B，也不证明整个插件已经清理完。请求分页物化、其余提醒恢复/显式重试和其它已定位重复投影仍有代码工作，不能归为只等安装。完整发布及现场14条规则验收尚未完成。

## v0.14.0 共享 Session 读取（2026-10-25）

v0.13.9 安装后仍卡顿，不能把此前单独投递 fold 的 61.60ms 当作 GUI 修复。普通 collect 原先会重新发现整段历史的工具、Session 和输出触发，再重复解析上下文、身份与交接；现已取消这条自动发现路径。迟注册和重启不再补跑历史规则。显式锚点重试仍保留原生事实解释与交接去重；已被原生 inbox 接纳的冻结提醒继续恢复，包括额度阻塞后被 claim 移除但尚未提交的输入。

所有相关消费者接入 Host 所有的共享 Session 读取服务。live 通过 eventAt 取不可变事件；并发冷读共享原生 observation，独立取消和释放，新的读取验证原生 revision。已读区间、精确事件和类型索引在消费者之间共用；尾部查询不会为了建索引先读无关前缀，重叠查询只填缺口。当前工具只派生配置范围内的 surface 尾部消息，使用原生投影并额外读取一条保留截断证据。诊断、工作台、摘要和维护不再各自复制全量日志。

通过实际 Loader、Session、JSONL 解码、Worker、鉴权 HTTP 和另一 Agent 请求进行一次真实长会话只读测试。业务日志有 **122473** 条原生事件；官方解码并建立测试 Session 后才开始计时，没有回写原始日志，也没有替换 Harness 实现。

| 阶段 | 墙钟/HTTP | CPU user / system | 事件循环最大间隔 |
|---|---|---|---|
| 首次普通收集 | 45.86ms；并发 HTTP 132.85ms | 并行阶段 172 / 47ms | 113.56ms |
| 另一 Agent 创建并完成请求 | 149.37ms | 已包含在并行阶段 | 已包含在并行阶段 |
| 后续空收集 | 0.21ms | 未单列 | 未单列 |
| 当前新工具命中、收集及原生去重 | 175.03ms；并发 HTTP 10.00ms | 250 / 15ms | 143.73ms |

收集与目录查询没有调用 readSession / observeSession 重新加载该 live 日志。以上不是零历史访问的声明：未完成输入、sticky/窗口以及 lifetime 共享消费的首次恢复仍以相应原生事实为准，必要时读取历史或逻辑语料，不能任意截断来重置状态。当前测试源是普通 surface 提醒，不能据此把所有规则路径都称为 175ms。

上述数字来自独立测试 Host，不含日志解码，也不是运行中桌面 GUI 的安装后 A/B。安装后需在同一 GUI 核对实际包版本、鉴权 HTTP 和事件循环，并继续 14 条思源规则的触发、原生投递及重复去重；自然时间窗不改系统钟。

最终检查：`pnpm release:check` 通过，含严格类型、事件目录一致性、475/475 单元、闭包打包/独立运行时约束与 Host/Client 构建；完整源码 Host 集成 189/189、客户端 24/24 通过。桌面清单 `0.2.1-rc.3` 的 ASAR 原生包通过隔离进程运行 4 项共享读取/当前命中测试，含实际 Loader、Session、冷 observation、Worker 与鉴权 HTTP，4/4 通过、stderr 为空；当前命中 36.72ms、并发 HTTP 4.48ms。该兼容测试用 tsx 加载测试 TypeScript，不替换桌面原生包，也未启动替代 GUI。首次直接 strip-types 方式因测试 `.js`→`.ts` 解析失败，改用现有 tsx 后通过；无报告的退出不计为通过。测试文件空包装不计入实质定向用例。

## v0.13.9 历史窗口恢复（2026-10-25）

桌面安装清单已确认 v0.13.8，但普通 `pwsh` 与 `SilentlyContinue` 拒绝探针都在工具正文执行前返回 `reminder-delivery-window-evidence-missing`。这不是拒绝规则通过。哥哥随后手动关闭插件，才继续本地构建和回归。

通过 Harness 官方 `readDecodedJsonlSource` 只读解码业务会话 `session-926f8ec0-ba38-4d1b-aa0d-c2c34e2cf9d7`，确认原生事件 `32571`、`53383` 是 `reminder/v2` 的 `test-window-1140-1150` 投递。两条均无 `reminder.window`、无 `evidence.event.clock.at`，但保存了 `evidence.clock.at`，分别属于 2026-10-14、2026-10-17 窗口。v0.13.8 投递恢复遗漏这个已有字段，共享额度恢复则已读取它。v0.13.9 仅补齐该读取，不重跑历史规则、不改写日志、不重置计数。

发布检查 `pnpm release:check` 的 475 项单元测试、类型检查和构建通过；完整源码宿主集成 184/184 通过。随后将平铺时钟回归进一步对齐现场的 v2 与缺省 sessionId，类型检查和两项定向历史恢复回归再次通过。覆盖窗口键与期限、committedIds、sticky 次数与冷却、共享额度和重复读取；runner 另外五项无匹配文件包装不计为实质定向用例。

使用官方只读解码后的真实 116,833 条事件、真实 Cordis Context 和当前构建产物的 `createSessionDeliveries.observeLog` 完成离线恢复，墙钟 61.60 ms，进程 CPU user 94 ms、system 0 ms。这里只测投递投影折叠，排除日志解码时间；没有注册替代 Session 服务，没有修改原始日志。这不是运行中 Host 的 CPU／事件循环采样，也不代表 HTTP 端到端延迟。

插件关闭期间的命令成功不计为安装后验收。v0.13.9 安装加载、普通调用与规则拒绝、14 条思源规则的现场投递和去重、真实长会话 HTTP／CPU／事件循环对照仍待完成。此前的 700 事件夹具数字继续保留其原有证据范围。

## v0.13.7 直接数据推送（2026-10-25）

v0.13.6 只发送失效通知，客户端收到后仍会发起页面 GET；连续对话会反复触发读取。v0.13.7 将同一鉴权 NDJSON 连接改为发送视图快照及改写增量。状态条订阅轻量状态；动作、提示、规则开关和运行页按当前页码及筛选条件订阅。订阅成员、分页、筛选、显式刷新和原生连接代次变化会重建连接；失败保留到重新订阅，没有定时或焦点重试。

真实 Loader、Session、鉴权 HTTP 与客户端共同运行的 `native activity pushes retained pages and rewrite deltas without follow-up HTTP requests` 用例，连续追加 12 轮原生会话事件及状态采样，再追加一条改写与一条维护动作。请求计数只有 `/context-care/changes` 一条，普通对话没有重复改写帧，真实改写通过 delta 到达客户端；动作与状态也直接更新。该用例包含四类视图和共享观察者，未替换宿主 Context。

发布检查 `pnpm release:check` 475/475、完整源码宿主集成 181/181、源码界面回归 24/24 均通过。新增真实注册表用例确认准备异常的原始消息可见，工具体未执行；故障源移除后下一次调用恢复。界面覆盖分页、筛选、显式刷新、保存确认竞态、取消、预览失效、跨会话隔离与卸载。

这些结果不替代桌面安装验收。原始桌面异常的具体原因尚未捕获；Host 内部仍在相关变更后构建订阅页面，再按签名抑制重复输出，不能据此宣称零计算开销。以下测量和门禁属于 v0.13.6 的历史记录。

## 思源时间窗声明的隔离宿主验收（2026-10-25）

从思源 callout `20261014114116-cduofoj` 回读现有 `test-window-1140-1150` 的完整声明和正文，新增 TypeScript 用例 `SiYuan 11:40 window: native delivery, deduplication, expiry and next-day recovery`。通过真实 Loader、Session、Worker 和原生投递投影执行，只向提醒运行时注入测试时钟，不修改系统时间或思源规则，不替换 Harness Context。

| 时刻与状态 | 投递结果 |
| --- | --- |
| 11:39:59.999 | 0，窗口外 |
| 11:40:00.000 | 1，正文及 ruleId 一致，提交原生 user/message |
| 同窗口重复请求 | 0，原生已提交记录抑制重复 |
| 清空运行缓存后，11:49:59.999 | 0，同窗口去重仍有效 |
| 新会话在末毫秒匹配，11:50:00.000 才收集 | 0，投递前再次检查窗口期限 |
| 次日 11:40，昨日提醒仍可见 | 1，新窗口键；随后重复请求为 0 |

测试会话只提交两条提醒，原生事件序号为 0、1；未打开 `context_care_reminders` 或 `context_care_reminder_claims`。定向源码集成测试退出 0，随后 `pnpm exec tsc -p tsconfig.tests.json` 退出 0。该证据验证现有声明的窗口及去重语义，不代表已安装桌面的真实思源来源加载或自然投递。2026-10-25 04:00 左右回读桌面包清单仍为 0.13.6，现场新版资源、HTTP 请求和全部 14 条规则的触发、投递及去重仍待安装后验收。

## v0.13.6 诊断查询延迟验收

2026-10-25，本机 Windows，明确指定外部 Harness 源码测试宿主。用真实 Cordis Loader、Session、连接鉴权和 HTTP 服务运行；没有替代 Harness Context。对应用例在 `test/integration.test.js`：`long Session diagnostic queries keep unrelated HTTP responsive and push only actual changes`。

## 复现及结果

夹具包含 700 条原生事件、350 次请求结算。每次请求头包含 120 个工具定义及带 200 条消息的工作台请求差异。基线保留原有 request-cache 读逻辑；轮询已经关闭，因此能单独确认同步查询本身的开销。所有测量都是同机夹具，不能替代实际部署的最终延迟。

| 测量 | 修改前 | 最终完整回归 |
| --- | ---: | ---: |
| 首次读取全部结算 | 447.81 ms | 17.76 ms |
| 重复读取 20 次 | 8017.09 ms | 7.89 ms |
| 查询前次路由 20 次 | 8024.82 ms | 0.078 ms |
| 不匹配路由的校准查询 20 次 | 5119.43 ms | 14.20 ms |
| 提示 HTTP 首次 / 后续 | 452.77 / 399.91–410.43 ms | 26.97 / 2.72–4.58 ms |
| 并发规则 HTTP 首次 / 后续 | 454.26 / 400.53–411.42 ms | 27.39 / 3.04–4.94 ms |

最终完整回归中，全部同步查询墙钟 40.25 ms，等待下一次事件循环 41.47 ms，进程 CPU 时间 78 ms。CPU 包含进程所有线程；同步段的 eventLoopUtilization 为 1，不能作为空闲 CPU 占用率。

瓶颈是每次查询对每条历史结算重复执行深度 JSON 校验，而结算引用了完整历史请求差异；前次路由查询还复用了整表投影。修复后，内部已接纳事实直接组合，路由倒序读取原生结算，校准先比较路由并缓存不可变 header 哈希。只读 GET 不再强制刷盘。

## 事件订阅与恢复

操作、提示、改写、开关和运行面板均没有 setInterval 或定时重试。客户端一条鉴权 NDJSON 流复用所有保留会话，宿主按实际提交、记录、来源和工作台变更发送失效通知；微任务和背压合并重复通知。初始快照订阅后发送，读取中的变化保留一次后续读取。连接代次变化和手动刷新失败流可重连；所有权归零和卸载取消连接与未完成读取。

来源定位通过 DOM/尺寸/原生投影通知观察目标出现，操作后单帧确认，并使用单次导航期限。共享额度依然从全逻辑语料恢复，扫描中按进度让出 Host；没有提醒入箱事件的冷日志省去 detached Session 构造。额度、窗口、原生已接受输入和取消的语义由完整真实宿主回归验证。

## 发布门禁

- `pnpm release:check`：464/464，零跳过；严格 TypeScript、事件目录一致性及构建成功。
- `DSH_TEST_CHECKOUT=D:/dev/deepseek-harness pnpm test:integration:source`：179/179，零跳过。
- `DSH_TEST_CHECKOUT=D:/dev/deepseek-harness pnpm test:client:source`：24/24。
- 推送流测试使用实际 ReadableStream/Response 验证分片、多会话共享、隔离、代次替换、空闲无读取、显式重试、取消及释放；HTTP 订阅使用真实 Host 鉴权和路由。
