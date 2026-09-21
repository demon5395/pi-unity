// unity-scripts/templates/PiBrickBreaker.cs
// 极简霓虹打砖块 —— 参考实现。
// 装入项目：unity asset write --to Assets/PiBrickBreaker/PiBrickBreaker.cs --template PiBrickBreaker
// 挂上组件：unity node create --name GameManager --components '["PiBrickBreaker"]'
//
// 场景由 CLI 搭好（见 skills/unity-game-dev/SKILL.md §3.5 的配方），本脚本只负责运行时行为：
//   球按常量速度直线运动 → 碰墙/挡板/砖块反弹 → 砖块 SetActive(false) 并加分 → 掉出底线扣命 → 清屏重置。
//
// 三个刻意的设计选择（写进 skill，也写在这里）：
//   1) **手写 AABB，不用 Rigidbody2D/Collider2D**：确定性好（首砖命中可预测），不依赖 2D 物理模块；
//   2) **球自动发射 + autoPaddle 默认 true**：不需要任何输入注入就能验证「画面在变、分数在涨」
//      （没有 Input System 包的项目无法注入真实输入，见 docs/PITFALLS.md U25）；
//   3) **分数用 OnGUI 画**：不依赖字体资产 / TMP / uGUI（决定②：不碰外部美术与 TMP）。
//
// ⚠️ 真机教训（必读）：`unity sprite set` 在 EditMode 挂上的 sprite 是**运行时对象**（非资产，
//    HideAndDontSave），进 PlayMode 的 **domain reload 会把它销毁**（读回 `spriteName` 变 null，
//    画面里一块砖都不渲染）；而 `color` 是组件上的**序列化字段**，能活下来。
//    故本脚本在 `Start()` 里做 **sprite 兜底**（`EnsureSprites`）：给任何缺 sprite 的
//    `SpriteRenderer` 补一张 **1×1 白 sprite**（PPU=1f，与 `unity-scripts/sprite-set.cs` 同一约定
//    → `localScale = 世界尺寸`），颜色照旧由 CLI 的 `unity sprite set` 设。
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class PiBrickBreaker : MonoBehaviour
{
    // ── 可调参数（execute-dynamic-code 可直接改公开字段做实验）──
    public float ballSpeedX = 3.2f;
    public float ballSpeedY = 4.2f;
    public bool autoPaddle = true;
    public float paddleFollowLerp = 12f;
    public float paddleKeySpeed = 8f;
    public float mouseFollowLerp = 18f;

    // ── 运行态（execute-dynamic-code 读回这些字段来证明「游戏在动」）──
    public int score;
    public int lives = 3;
    public int bricksAlive;
    public float ballX;
    public float ballY;
    public float paddleX;

    // 场地边界：与相机 orthographicSize = 5 对应（半高 5、半宽 6）
    // ⚠️ **坐标口径（F7/R326，必读）**：本参考实现假设**关卡根在世界原点**，全程只用
    //    `localPosition`，却与世界空间常量（HalfWidth/HalfHeight/PaddleY/BallStartY…）混算。
    //    只在「Bricks/Paddle/Ball 的父链都是原点」时成立；把整关挪到非原点会失效
    //    （AABB 命中、反弹边界、挡板 y 全部会偏）。要平移整关：要么同步改这些常量，
    //    要么改成 `TransformPoint`/世界坐标口径。
    private const float HalfWidth = 6f;
    private const float HalfHeight = 5f;
    private const float PaddleY = -4.2f;
    private const float BallStartY = -3.2f;
    private const float PaddleHalfWidth = 1.2f;
    private const float BrickHalfWidth = 0.8f;   // 砖块 1.6 x 0.5 → 半尺寸 0.8 / 0.25
    private const float BrickHalfHeight = 0.25f;
    private const float BallHalfSize = 0.2f;

    private class Brick
    {
        public GameObject go;
        public Vector3 home;
        public bool alive;
    }

    private Transform _ball;
    private Transform _paddle;
    private readonly List<Brick> _bricks = new List<Brick>();
    private Vector2 _velocity;

    void Start()
    {
        Camera cam = Camera.main;
        if (cam != null)
        {
            cam.orthographic = true;
            cam.orthographicSize = HalfHeight;
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color32(0x0A, 0x0A, 0x14, 255);   // #0A0A14 近黑底
        }
        EnsureSprites();
        _ball = FindTransform("Ball");
        _paddle = FindTransform("Paddle");
        CollectBricks();
        ResetBall();
        Debug.Log("[BB] ready bricks=" + bricksAlive + " lives=" + lives);
    }

    void Update()
    {
        if (_ball == null) return;

        Vector3 p = _ball.localPosition;
        p.x += _velocity.x * Time.deltaTime;
        p.y += _velocity.y * Time.deltaTime;

        // 左右墙 / 天花板
        if (p.x > HalfWidth - BallHalfSize) { p.x = HalfWidth - BallHalfSize; _velocity.x = -Mathf.Abs(_velocity.x); }
        else if (p.x < -HalfWidth + BallHalfSize) { p.x = -HalfWidth + BallHalfSize; _velocity.x = Mathf.Abs(_velocity.x); }
        if (p.y > HalfHeight - BallHalfSize) { p.y = HalfHeight - BallHalfSize; _velocity.y = -Mathf.Abs(_velocity.y); }

        // 挡板
        if (_paddle != null && _velocity.y < 0f
            && p.y <= PaddleY + 0.35f && p.y >= PaddleY - 0.35f
            && Mathf.Abs(p.x - _paddle.localPosition.x) <= PaddleHalfWidth + BallHalfSize)
        {
            p.y = PaddleY + 0.35f;
            _velocity.y = Mathf.Abs(_velocity.y);
        }

        // 砖块（AABB；命中即反竖直方向并 continue 到掉出判定）
        for (int i = 0; i < _bricks.Count; i++)
        {
            Brick brick = _bricks[i];
            if (!brick.alive || brick.go == null) continue;
            Vector3 b = brick.go.transform.localPosition;
            if (Mathf.Abs(p.x - b.x) <= BrickHalfWidth + BallHalfSize
                && Mathf.Abs(p.y - b.y) <= BrickHalfHeight + BallHalfSize)
            {
                brick.alive = false;
                brick.go.SetActive(false);
                bricksAlive = _bricks.Count(x => x.alive);
                score++;
                Debug.Log("[BB] hit brick=" + brick.go.name + " score=" + score + " left=" + bricksAlive);
                _velocity.y = -_velocity.y;
                break;
            }
        }

        // 掉出底线
        if (p.y < -HalfHeight - 0.5f)
        {
            lives--;
            Debug.Log("[BB] ball out lives=" + lives);
            if (lives <= 0)
            {
                Debug.Log("[BB] GAME OVER score=" + score);
                lives = 3;
                score = 0;
                RestoreBricks();
            }
            ResetBall();
            p = _ball.localPosition;
        }

        _ball.localPosition = p;
        ballX = p.x;
        ballY = p.y;

        if (_paddle != null)
        {
            float target = autoPaddle ? Mathf.Clamp(p.x, -HalfWidth + PaddleHalfWidth, HalfWidth - PaddleHalfWidth) : InputTarget();
            Vector3 pp = _paddle.localPosition;
            pp.x = Mathf.Lerp(pp.x, target, Mathf.Clamp01(paddleFollowLerp * Time.deltaTime));
            pp.y = PaddleY;
            _paddle.localPosition = pp;
            paddleX = pp.x;
        }

        if (_bricks.Count > 0 && bricksAlive == 0)
        {
            Debug.Log("[BB] CLEARED score=" + score);
            RestoreBricks();
        }
    }

    /// <summary>玩家输入（legacy Input；没有 Input System 包的项目也能用）。autoPaddle 关掉后才生效。</summary>
    float InputTarget()
    {
        float dir = 0f;
        if (Input.GetKey(KeyCode.LeftArrow)) dir -= 1f;
        if (Input.GetKey(KeyCode.RightArrow)) dir += 1f;
        if (Mathf.Abs(dir) < 0.01f)
        {
            Vector3 mouse = Input.mousePosition;
            if (Camera.main != null && Screen.width > 0)
            {
                // F6/R325：`mouseFollowLerp` 真正生效（否则是死字段，会误导「改公开字段做实验」的人）。
                // `ScreenToWorldPoint` 给的是**世界** x，挡板读的是 `localPosition` —— 这就回到上面那条
                // 「关卡根必须在世界原点」的假设（F7）。
                float mouseX = Camera.main.ScreenToWorldPoint(mouse).x;
                return Mathf.Lerp(_paddle.localPosition.x, mouseX, Mathf.Clamp01(mouseFollowLerp * Time.deltaTime));
            }
            return _paddle.localPosition.x;
        }
        return Mathf.Clamp(
            _paddle.localPosition.x + dir * paddleKeySpeed * Time.deltaTime,
            -HalfWidth + PaddleHalfWidth, HalfWidth - PaddleHalfWidth);
    }

    /// <summary>测试入口：直接设挡板 x（execute-dynamic-code 用）。</summary>
    public void SetPaddleX(float x)
    {
        if (_paddle == null) return;
        _paddle.localPosition = new Vector3(
            Mathf.Clamp(x, -HalfWidth + PaddleHalfWidth, HalfWidth - PaddleHalfWidth), PaddleY, 0f);
    }

    /// <summary>测试入口：把球放回起点、按当前速度重新发射。</summary>
    public void ResetBall()
    {
        if (_ball == null) return;
        _ball.localPosition = new Vector3(0f, BallStartY, 0f);
        _velocity = new Vector2(ballSpeedX, ballSpeedY);
    }

    void CollectBricks()
    {
        _bricks.Clear();
        GameObject root = GameObject.Find("Bricks");
        if (root == null) { bricksAlive = 0; return; }
        foreach (Transform child in root.transform)
        {
            _bricks.Add(new Brick { go = child.gameObject, home = child.localPosition, alive = true });
        }
        bricksAlive = _bricks.Count;
    }

    void RestoreBricks()
    {
        foreach (Brick brick in _bricks)
        {
            if (brick.go == null) continue;
            brick.alive = true;
            brick.go.SetActive(true);
            brick.go.transform.localPosition = brick.home;
        }
        bricksAlive = _bricks.Count;
    }

    static Transform FindTransform(string name)
    {
        GameObject go = GameObject.Find(name);
        return go != null ? go.transform : null;
    }

    /// <summary>
    /// sprite 兜底：EditMode 里 `unity sprite set` 造的 sprite 是运行时对象，
    /// 进 PlayMode 的 domain reload 会销毁它（实测 `spriteName` 变 null，砖块不渲染），
    /// 但 `SpriteRenderer.color`（序列化字段）会保留。故这里给**任何缺 sprite 的**
    /// SpriteRenderer 补一张共用的 1×1 白 sprite（PPU=1f）——颜色由 CLI 设，白底把它乘出来。
    /// </summary>
    void EnsureSprites()
    {
        Sprite fallback = null;
        SpriteRenderer[] renderers = FindObjectsOfType<SpriteRenderer>();
        for (int i = 0; i < renderers.Length; i++)
        {
            if (renderers[i].sprite != null) continue;
            if (fallback == null) fallback = CreateUnitSprite();
            renderers[i].sprite = fallback;
        }
    }

    /// <summary>1×1 白 sprite（PPU=1f → 1×1 世界单位，与 unity-scripts/sprite-set.cs 同一约定）。</summary>
    static Sprite CreateUnitSprite()
    {
        Texture2D tex = new Texture2D(1, 1, TextureFormat.RGBA32, false);
        tex.SetPixel(0, 0, Color.white);
        tex.Apply();
        tex.hideFlags = HideFlags.HideAndDontSave;
        Sprite sp = Sprite.Create(tex, new Rect(0, 0, 1, 1), new Vector2(0.5f, 0.5f), 1f);
        sp.hideFlags = HideFlags.HideAndDontSave;
        return sp;
    }

    void OnGUI()
    {
        // 不依赖字体资产 / TMP：GUI.skin 的默认字体足够（决定②：不碰 TMP 与外部资源）
        GUI.Label(new Rect(12f, 10f, 460f, 32f),
            "SCORE " + score + "   LIVES " + lives + "   BRICKS " + bricksAlive);
    }
}
