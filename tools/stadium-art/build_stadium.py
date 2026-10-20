"""マイスタジアムの箱庭ジオラマを Blender で組み立てて描き出す。

使い方（リポジトリのルートで）:
  blender -b --factory-startup -P tools/stadium-art/build_stadium.py -- --mode preview --stand 3 --shop 2 --vault 2 --out <dir>
  blender -b --factory-startup -P tools/stadium-art/build_stadium.py -- --mode final --out assets/stadium

final は、同じカメラで次の層を描き出し、画面が重ねて使う位置情報を stadium-art.json に書く。
  base-stand-1..6.webp   土台とスタジアム（段ごと）
  shop-1..4.webp         売店（透過。影は影受けの面で残す）
  vault-1..4.webp        金庫（透過）
  scaffold-stand/shop/vault.webp  建設中の足場（透過）
観客の点は描かず、見える客席の位置だけを書き出す（画面が入場者数に合わせて埋める）。
"""

import json
import math
import os
import random
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

# ───────────── 引数 ─────────────

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in ARGV:
        index = ARGV.index(name)
        if index + 1 < len(ARGV):
            return ARGV[index + 1]
    return default


MODE = arg("--mode", "preview")
OUT = os.path.abspath(arg("--out", "."))
STAND = int(arg("--stand", "3"))
SHOP = int(arg("--shop", "1"))
VAULT = int(arg("--vault", "1"))
WIDTH = int(arg("--width", "1600" if MODE == "final" else "800"))
HEIGHT = int(arg("--height", str(WIDTH * 3 // 4)))
SAMPLES = int(arg("--samples", "128" if MODE == "final" else "32"))
ONLY = arg("--only", "")

# ───────────── 色（sRGB の16進で書き、線形へ直す） ─────────────

PALETTE = {
    "night": "#17234a",
    "grass": "#2c6a47",
    "grass_dark": "#235a3b",
    "pitch": "#2f8f4e",
    "pitch_light": "#3aa35c",
    "line": "#f4f1ea",
    "track": "#6a2a2f",
    "plinth_side": "#3a0f22",
    "plinth_band": "#e6c17a",
    "paving": "#4a4e63",
    "paving_light": "#6b7088",
    "concrete": "#8d8f9c",
    "concrete_dark": "#5b5d6b",
    "steel": "#9aa3b5",
    "steel_dark": "#4b5262",
    "wood": "#9a6a3a",
    "wood_dark": "#6e4524",
    "seat_grey": "#c9ccd6",
    "seat_wine": "#9c1f4f",
    "seat_rose": "#ff4f8f",
    "seat_gold": "#e6c17a",
    "gold": "#e6c17a",
    "gold_bright": "#ffd98a",
    "lamp": "#fff1d6",
    "glass": "#bfe6ff",
    "awning_pink": "#ff7ab6",
    "awning_white": "#fff4f8",
    "tree": "#1e5a3a",
    "tree_dark": "#164a30",
    "trunk": "#5a3a22",
    "window": "#ffd28a",
    "safe": "#5f6f86",
    "safe_dark": "#36404f",
}


def srgb_to_linear(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def color(name_or_hex, alpha=1.0):
    text = PALETTE.get(name_or_hex, name_or_hex)
    r, g, b = (int(text[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), alpha)


# ───────────── シーンの準備 ─────────────


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.render.resolution_x = WIDTH
    scene.render.resolution_y = HEIGHT
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.transparent_max_bounces = 8
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Punchy"
    except TypeError:
        try:
            scene.view_settings.look = "Punchy"
        except TypeError:
            pass
    prefs = bpy.context.preferences.addons["cycles"].preferences
    chosen = None
    for device_type in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = device_type
            prefs.get_devices()
            if any(device.type == device_type for device in prefs.devices):
                chosen = device_type
                break
        except TypeError:
            continue
    if chosen:
        for device in prefs.devices:
            device.use = device.type == chosen
        scene.cycles.device = "GPU"
    world = bpy.data.worlds.new("Night")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = color("night")
    background.inputs["Strength"].default_value = 0.8
    return scene


MATERIALS = {}


def material(name, base, roughness=0.6, metallic=0.0, emission=None, strength=0.0, alpha=1.0,
             transmission=0.0, coat=0.0, noise=None):
    if name in MATERIALS:
        return MATERIALS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")

    def put(key, value):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = value

    put("Base Color", color(base))
    put("Roughness", roughness)
    put("Metallic", metallic)
    put("Alpha", alpha)
    put("Transmission Weight", transmission)
    put("Coat Weight", coat)
    if emission:
        put("Emission Color", color(emission))
        put("Emission Strength", strength)
    if noise:
        # noise = (second color, scale): 面のむらで単色ののっぺり感を消す。
        second, scale = noise
        texture = nodes.new("ShaderNodeTexNoise")
        texture.inputs["Scale"].default_value = scale
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = color(base)
        ramp.color_ramp.elements[1].color = color(second)
        ramp.color_ramp.elements[0].position = 0.35
        ramp.color_ramp.elements[1].position = 0.7
        links.new(texture.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    MATERIALS[name] = mat
    return mat


def stripes_material(name, first, second, count, axis="X", length=22.0):
    """ピッチの芝の縞。オブジェクト座標の片方の軸で交互に色を変える。"""
    if name in MATERIALS:
        return MATERIALS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.85
    coords = nodes.new("ShaderNodeTexCoord")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coords.outputs["Object"], separate.inputs["Vector"])
    scale = nodes.new("ShaderNodeMath")
    scale.operation = "MULTIPLY"
    scale.inputs[1].default_value = count / length
    links.new(separate.outputs[axis], scale.inputs[0])
    fraction = nodes.new("ShaderNodeMath")
    fraction.operation = "FRACT"
    links.new(scale.outputs[0], fraction.inputs[0])
    # 0〜0.5 と 0.5〜1 で色を切り替える（段のある色の帯）。
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = color(first)
    ramp.color_ramp.elements[1].position = 0.5
    ramp.color_ramp.elements[1].color = color(second)
    links.new(fraction.outputs[0], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    MATERIALS[name] = mat
    return mat


# ───────────── 形を作る道具 ─────────────

COLLECTIONS = {}


def collection(name):
    if name not in COLLECTIONS:
        coll = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(coll)
        COLLECTIONS[name] = coll
    return COLLECTIONS[name]


CURRENT = ["base"]


def link(obj):
    collection(CURRENT[0]).objects.link(obj)
    return obj


def mesh_object(name, verts, faces, materials, indices=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    for mat in materials:
        mesh.materials.append(mat)
    if indices:
        for polygon, index in zip(mesh.polygons, indices):
            polygon.material_index = index
    obj = bpy.data.objects.new(name, mesh)
    return link(obj)


def box(name, center, size, mat, bevel=0.0, rotation=0.0):
    sx, sy, sz = (value / 2 for value in size)
    verts = [(x * sx, y * sy, z * sz) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    obj = mesh_object(name, verts, faces, [mat])
    obj.location = center
    obj.rotation_euler[2] = rotation
    if bevel:
        modifier = obj.modifiers.new("bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
    return obj


def cylinder(name, center, radius, depth, mat, vertices=16, rotation=(0.0, 0.0, 0.0)):
    verts = []
    for z in (-depth / 2, depth / 2):
        for i in range(vertices):
            angle = 2 * math.pi * i / vertices
            verts.append((radius * math.cos(angle), radius * math.sin(angle), z))
    faces = [tuple(range(vertices))[::-1], tuple(range(vertices, 2 * vertices))]
    for i in range(vertices):
        j = (i + 1) % vertices
        faces.append((i, j, vertices + j, vertices + i))
    obj = mesh_object(name, verts, faces, [mat])
    obj.location = center
    obj.rotation_euler = rotation
    return obj


def cone(name, center, radius, depth, mat, vertices=12):
    verts = [(radius * math.cos(2 * math.pi * i / vertices), radius * math.sin(2 * math.pi * i / vertices), 0)
             for i in range(vertices)]
    verts.append((0, 0, depth))
    faces = [tuple(range(vertices))[::-1]]
    for i in range(vertices):
        faces.append((i, (i + 1) % vertices, vertices))
    obj = mesh_object(name, verts, faces, [mat])
    obj.location = center
    return obj


def sphere(name, center, radius, mat, segments=16, rings=10, scale=(1, 1, 1)):
    verts = [(0, 0, radius)]
    for ring in range(1, rings):
        phi = math.pi * ring / rings
        for seg in range(segments):
            theta = 2 * math.pi * seg / segments
            verts.append((radius * math.sin(phi) * math.cos(theta), radius * math.sin(phi) * math.sin(theta),
                          radius * math.cos(phi)))
    verts.append((0, 0, -radius))
    faces = []
    for seg in range(segments):
        faces.append((0, 1 + seg, 1 + (seg + 1) % segments))
    for ring in range(rings - 2):
        start = 1 + ring * segments
        for seg in range(segments):
            a = start + seg
            b = start + (seg + 1) % segments
            faces.append((a, a + segments, b + segments, b))
    last = len(verts) - 1
    start = 1 + (rings - 2) * segments
    for seg in range(segments):
        faces.append((start + seg, last, start + (seg + 1) % segments))
    obj = mesh_object(name, verts, faces, [mat])
    obj.location = center
    obj.scale = scale
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def ring_point(a, b, t, n=3.0):
    """丸みのある長方形（スーパー楕円）の上の点。t は 0〜2π。"""
    c, s = math.cos(t), math.sin(t)
    return (a * math.copysign(abs(c) ** (2 / n), c), b * math.copysign(abs(s) ** (2 / n), s))


def band(name, a, b, depth, z_top, t0, t1, mats, closed=False, slab=None, steps=None, z_bottom=0.0):
    """スタンドの1列。内側の縁から外側の縁まで幅 depth、高さ z_top の帯。
    mats = (上面, 内側の壁, 外側の壁と端)。slab を渡すと、下まで埋めずに板にする。"""
    span = t1 - t0
    steps = steps or max(8, int(abs(span) * (a + b) / 1.4))
    count = steps if closed else steps + 1
    ts = [t0 + span * i / steps for i in range(count)]
    bottom = z_top - slab if slab else z_bottom
    verts = []
    for t in ts:
        ix, iy = ring_point(a, b, t)
        ox, oy = ring_point(a + depth, b + depth, t)
        verts.extend([(ix, iy, bottom), (ix, iy, z_top), (ox, oy, z_top), (ox, oy, bottom)])
    faces = []
    indices = []
    segments = count if closed else count - 1
    for i in range(segments):
        j = (i + 1) % count
        ib, it, ot, ob = 4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 3
        jb, jt, jo, jbb = 4 * j, 4 * j + 1, 4 * j + 2, 4 * j + 3
        faces.append((it, jt, jo, ot))
        indices.append(0)
        faces.append((ib, jb, jt, it))
        indices.append(1)
        faces.append((ob, ot, jo, jbb))
        indices.append(2)
        if slab:
            faces.append((ib, ob, jbb, jb))
            indices.append(2)
    if not closed:
        last = 4 * (count - 1)
        faces.append((0, 1, 2, 3))
        indices.append(2)
        faces.append((last + 3, last + 2, last + 1, last))
        indices.append(2)
    return mesh_object(name, verts, faces, list(mats), indices)


# ───────────── 土台 ─────────────

PITCH_A, PITCH_B = 11.0, 6.5
BOWL_A, BOWL_B = 12.6, 8.2
PLINTH = {"x": 27.5, "y_min": -30.5, "y_max": 22.5, "depth": 2.6}
SHOP_PLOT = (-17.0, -23.6)
VAULT_PLOT = (17.0, -23.6)
PLOT_SIZE = (12.6, 9.4)
FACILITY_SCALE = 1.35
PLAZA = (0.0, -25.0)


def build_plinth():
    CURRENT[0] = "base"
    cx = 0.0
    cy = (PLINTH["y_min"] + PLINTH["y_max"]) / 2
    half_x = PLINTH["x"]
    half_y = (PLINTH["y_max"] - PLINTH["y_min"]) / 2
    grass = material("grass", "grass", roughness=0.9, noise=("grass_dark", 0.6))
    side = material("plinth_side", "plinth_side", roughness=0.7, noise=("#2a0a18", 1.4))
    trim = material("plinth_trim", "plinth_band", roughness=0.3, metallic=0.8, emission="gold", strength=0.4)
    # 丸い角の土台。上面は芝、側面はワイン色、上の縁に金の帯。
    steps = 96
    top = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        x, y = ring_point(half_x, half_y, t, n=6.0)
        top.append((cx + x, cy + y))
    verts = [(x, y, 0.0) for x, y in top] + [(x, y, -PLINTH["depth"]) for x, y in top]
    faces = [tuple(range(steps))]
    indices = [0]
    for i in range(steps):
        j = (i + 1) % steps
        faces.append((i, steps + i, steps + j, j))
        indices.append(1)
    faces.append(tuple(range(2 * steps - 1, steps - 1, -1)))
    indices.append(1)
    mesh_object("plinth", verts, faces, [grass, side], indices)
    trim_verts = []
    for x, y in top:
        trim_verts.append((x, y, -0.05))
        trim_verts.append((x, y, -0.32))
    trim_faces = []
    for i in range(steps):
        j = (i + 1) % steps
        trim_faces.append((2 * i, 2 * i + 1, 2 * j + 1, 2 * j))
    trim_obj = mesh_object("plinth_trim", trim_verts, trim_faces, [trim])
    trim_obj.scale = (1.004, 1.004, 1)

    paving = material("paving", "paving", roughness=0.8, noise=("paving_light", 3.0))
    track = material("track", "track", roughness=0.85, noise=("#5a2228", 2.0))
    pitch = stripes_material("pitch", "pitch", "pitch_light", 10, axis="X", length=PITCH_A * 2)
    line = material("line", "line", roughness=0.6, emission="line", strength=0.15)

    # 競技場の外周（トラック）とピッチ。
    disc_steps = 72
    ring = [ring_point(BOWL_A, BOWL_B, 2 * math.pi * i / disc_steps) for i in range(disc_steps)]
    mesh_object("track", [(x, y, 0.02) for x, y in ring], [tuple(range(disc_steps))], [track])
    box("pitch", (0, 0, 0.04), (PITCH_A * 2, PITCH_B * 2, 0.04), pitch)
    for name, center, size in (
        ("line_n", (0, PITCH_B - 0.06, 0.07), (PITCH_A * 2, 0.12, 0.01)),
        ("line_s", (0, -PITCH_B + 0.06, 0.07), (PITCH_A * 2, 0.12, 0.01)),
        ("line_e", (PITCH_A - 0.06, 0, 0.07), (0.12, PITCH_B * 2, 0.01)),
        ("line_w", (-PITCH_A + 0.06, 0, 0.07), (0.12, PITCH_B * 2, 0.01)),
        ("line_mid", (0, 0, 0.07), (0.12, PITCH_B * 2, 0.01)),
        ("box_e", (PITCH_A - 1.6, 0, 0.07), (0.12, 6.0, 0.01)),
        ("box_w", (-PITCH_A + 1.6, 0, 0.07), (0.12, 6.0, 0.01)),
    ):
        box(name, center, size, line)
    for side_x in (1, -1):
        for y in (3.0, -3.0):
            box(f"box_edge_{side_x}_{y}", (side_x * (PITCH_A - 0.8), y, 0.07), (1.6, 0.12, 0.01), line)
    circle_steps = 40
    circle = []
    for i in range(circle_steps):
        t = 2 * math.pi * i / circle_steps
        circle.append((1.9 * math.cos(t), 1.9 * math.sin(t), 0.072))
        circle.append((1.78 * math.cos(t), 1.78 * math.sin(t), 0.072))
    mesh_object("center_circle", circle,
                [(2 * i, 2 * ((i + 1) % circle_steps), 2 * ((i + 1) % circle_steps) + 1, 2 * i + 1)
                 for i in range(circle_steps)], [line])

    # 前の広場と、売店・金庫の区画、スタジアムへの道。
    box("plaza", (PLAZA[0], PLAZA[1], 0.03), (11.0, 8.0, 0.06), paving, bevel=0.2)
    box("approach", (0, PLAZA[1] + 5.5, 0.03), (4.6, 4.0, 0.06), paving)
    for name, (x, y) in (("shop_plot", SHOP_PLOT), ("vault_plot", VAULT_PLOT)):
        box(name, (x, y, 0.035), (PLOT_SIZE[0], PLOT_SIZE[1], 0.07), paving, bevel=0.25)
    curb = material("curb", "paving_light", roughness=0.7)
    for name, (x, y) in (("shop_curb", SHOP_PLOT), ("vault_curb", VAULT_PLOT)):
        band(name, PLOT_SIZE[0] / 2 - 0.1, PLOT_SIZE[1] / 2 - 0.1, 0.18, 0.12, 0, 2 * math.pi, (curb, curb, curb),
             closed=True, steps=48).location = (x, y, 0)

    # スタジアムがいずれ広がる外周に遊歩道を回す（低い段では「ここまで育つ」の目安になる）。
    walk = material("walkway", "paving_light", roughness=0.8, noise=("paving", 4.0))
    band("walkway", 24.2, 19.8, 0.9, 0.05, 0, 2 * math.pi, (walk, walk, walk), closed=True, slab=0.05)
    hedge = material("hedge", "tree_dark", roughness=0.9, noise=("tree", 3.0))
    for index, (start, end) in enumerate(((110, 160), (20, 70))):
        band(f"hedge_{index}", 25.4, 21.0, 0.5, 0.55, deg(start), deg(end), (hedge, hedge, hedge), slab=0.55)
    bench = material("bench", "wood", roughness=0.7)
    for index, t in enumerate((35, 60, 120, 145)):
        x, y = ring_point(25.0, 20.6, deg(t))
        box(f"bench_{index}", (x, y, 0.3), (1.2, 0.4, 0.12), bench, rotation=deg(t) + math.pi / 2)

    # 木と街灯。位置は種を固定した乱数で決め、毎回同じにする。
    rng = random.Random(7)
    leaf = material("leaf", "tree", roughness=0.8, noise=("tree_dark", 2.0))
    trunk = material("trunk", "trunk", roughness=0.9)
    spots = []
    for _ in range(400):
        x = rng.uniform(-half_x + 2, half_x - 2)
        y = rng.uniform(PLINTH["y_min"] + 2, PLINTH["y_max"] - 2)
        inside_bowl = (abs(x) / 26.2) ** 3 + (abs(y) / 21.8) ** 3 < 1
        near_plots = any(abs(x - px) < PLOT_SIZE[0] / 2 + 1.2 and abs(y - py) < PLOT_SIZE[1] / 2 + 1.2
                         for px, py in (SHOP_PLOT, VAULT_PLOT))
        on_plaza = abs(x) < 7.5 and y < PLAZA[1] + 8.0
        if inside_bowl or near_plots or on_plaza:
            continue
        if any((x - sx) ** 2 + (y - sy) ** 2 < 4.0 for sx, sy in spots):
            continue
        spots.append((x, y))
        if len(spots) >= 60:
            break
    for index, (x, y) in enumerate(spots):
        height = rng.uniform(1.6, 2.6)
        cylinder(f"trunk_{index}", (x, y, 0.4), 0.16, 0.8, trunk, vertices=8)
        if index % 3 == 0:
            cone(f"pine_{index}", (x, y, 0.6), rng.uniform(0.9, 1.2), height + 0.6, leaf, vertices=10)
        else:
            sphere(f"tree_{index}", (x, y, 0.8 + height / 2), rng.uniform(0.9, 1.3), leaf, segments=12, rings=8,
                   scale=(1, 1, 1.15))
    lamp_mat = material("lamp_glow", "lamp", emission="lamp", strength=12.0)
    pole_mat = material("lamp_pole", "steel_dark", roughness=0.4, metallic=0.8)
    lamp_spots = ((-3.0, PLAZA[1] + 6.8), (3.0, PLAZA[1] + 6.8), (-6.0, PLAZA[1] - 3.6), (6.0, PLAZA[1] - 3.6),
                  (-6.0, PLAZA[1] + 2.2), (6.0, PLAZA[1] + 2.2))
    for index, (x, y) in enumerate(lamp_spots):
        cylinder(f"lamp_pole_{index}", (x, y, 0.9), 0.07, 1.8, pole_mat, vertices=8)
        sphere(f"lamp_head_{index}", (x, y, 1.9), 0.22, lamp_mat, segments=10, rings=6)
        light = bpy.data.lights.new(f"lamp_light_{index}", "POINT")
        light.energy = 140.0
        light.color = color("lamp")[:3]
        light.shadow_soft_size = 0.3
        light_obj = bpy.data.objects.new(f"lamp_light_{index}", light)
        light_obj.location = (x, y, 2.3)
        # 街灯の光は売店・金庫の層にも当てたいので、常に出す照明の集まりへ入れる。
        CURRENT[0] = "lights"
        link(light_obj)
        CURRENT[0] = "base"


# ───────────── 照明とカメラ ─────────────


def build_lights():
    CURRENT[0] = "lights"
    moon = bpy.data.lights.new("moon", "SUN")
    moon.energy = 2.6
    moon.color = color("#b8c8ff")[:3]
    moon.angle = math.radians(6)
    moon_obj = bpy.data.objects.new("moon", moon)
    moon_obj.rotation_euler = (math.radians(50), math.radians(-18), math.radians(-35))
    link(moon_obj)
    fill = bpy.data.lights.new("fill", "AREA")
    fill.energy = 12000.0
    fill.size = 60.0
    fill.color = color("#ffd9b8")[:3]
    fill_obj = bpy.data.objects.new("fill", fill)
    fill_obj.location = (0, -10, 45)
    link(fill_obj)


CAMERA = {"elevation": float(arg("--elev", "42")), "azimuth": float(arg("--az", "30"))}


def build_camera(scene):
    camera_data = bpy.data.cameras.new("camera")
    camera_data.type = "ORTHO"
    camera_data.clip_start = 1.0
    camera_data.clip_end = 600.0
    camera = bpy.data.objects.new("camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    tilt = math.radians(90 - CAMERA["elevation"])
    camera.rotation_euler = (tilt, 0.0, math.radians(CAMERA["azimuth"]))
    bpy.context.view_layer.update()
    rotation = camera.matrix_world.to_3x3()
    right = rotation.col[0].normalized()
    up = rotation.col[1].normalized()
    forward = -rotation.col[2].normalized()
    # どの段でも同じ枠になるよう、土台と一番大きいドームの高さで枠を決める。
    points = []
    for z in (0.0, -PLINTH["depth"]):
        for t in range(0, 360, 10):
            x, y = ring_point(PLINTH["x"], (PLINTH["y_max"] - PLINTH["y_min"]) / 2, math.radians(t), n=6.0)
            points.append(Vector((x, y + (PLINTH["y_max"] + PLINTH["y_min"]) / 2, z)))
    points.append(Vector((0, 0, 16.0)))
    points.append(Vector((0, 18.0, 13.0)))
    xs = [point.dot(right) for point in points]
    ys = [point.dot(up) for point in points]
    width = max(xs) - min(xs)
    height = max(ys) - min(ys)
    aspect = WIDTH / HEIGHT
    camera_data.ortho_scale = max(width, height * aspect) * 1.06
    cx = (max(xs) + min(xs)) / 2
    cy = (max(ys) + min(ys)) / 2
    camera.location = right * cx + up * cy - forward * 200.0
    bpy.context.view_layer.update()
    return camera


# ───────────── スタンド ─────────────

STAND_NAMES = ["仮設スタンド", "木造スタンド", "鉄骨スタンド", "二層スタンド", "屋根付きスタンド", "ドーム"]
ROW_DEPTH = 0.92
ROW_RISE = 0.5


def deg(value):
    return math.radians(value)


def stand_spec(level):
    """段ごとの客席。segments は (開始角, 終了角, 列数)。角度は +x が0度、奥（+y）が90度。"""
    if level == 1:
        return {"segments": [(62, 118, 3)], "style": "scaffold", "upper": None}
    if level == 2:
        return {"segments": [(40, 140, 4), (246, 294, 2)], "style": "wood", "upper": None}
    if level == 3:
        return {"segments": [(18, 162, 5), (162, 198, 3), (342, 378, 3), (232, 308, 3)], "style": "steel",
                "upper": None}
    if level == 4:
        return {"segments": [(0, 360, 5)], "style": "bowl", "upper": (14, 166, 4)}
    if level == 5:
        return {"segments": [(0, 360, 5)], "style": "bowl", "upper": (-8, 188, 4), "roof": (-8, 188)}
    return {"segments": [(0, 360, 6)], "style": "dome", "upper": (0, 360, 4), "roof": None, "dome": True}


SEATS = []


def seat_points(a, b, z, t0, t1, spacing=0.62):
    """列の上面の中ほどに、客席の点を等間隔に置く（観客の点の位置）。"""
    span = t1 - t0
    mid_a = a + ROW_DEPTH * 0.55
    mid_b = b + ROW_DEPTH * 0.55
    length = abs(span) * (mid_a + mid_b) / 2
    count = max(2, int(length / spacing))
    margin = 0.5 / count
    points = []
    for i in range(count):
        t = t0 + span * (margin + (1 - 2 * margin) * i / max(1, count - 1))
        x, y = ring_point(mid_a, mid_b, t)
        points.append(Vector((x, y, z + 0.18)))
    return points


def build_rows(prefix, a0, b0, base_z, rows, t0, t1, seat_mat, riser_mat, wall_mat, closed, slab=None,
               seat_back=None):
    seat_list = []
    for row in range(rows):
        a = a0 + row * ROW_DEPTH
        b = b0 + row * ROW_DEPTH
        z = base_z + (row + 1) * ROW_RISE
        band(f"{prefix}_row{row}", a, b, ROW_DEPTH, z, t0, t1, (seat_mat, riser_mat, wall_mat), closed=closed,
             slab=slab)
        if seat_back:
            band(f"{prefix}_back{row}", a + ROW_DEPTH - 0.14, b + ROW_DEPTH - 0.14, 0.14, z + 0.2, t0, t1,
                 (seat_back, seat_back, seat_back), closed=closed, slab=0.2)
        seat_list.extend(seat_points(a, b, z, t0, t1))
    return seat_list


def floodlight(name, x, y, height, aim=(0.0, 0.0, 0.0), energy=1800.0, head=(1.4, 0.4, 0.9)):
    pole = material("flood_pole", "steel", roughness=0.35, metallic=0.9)
    glow = material("flood_glow", "lamp", emission="lamp", strength=30.0)
    frame = material("flood_frame", "steel_dark", roughness=0.4, metallic=0.9)
    cylinder(f"{name}_pole", (x, y, height / 2), 0.16, height, pole, vertices=10)
    direction = Vector(aim) - Vector((x, y, height))
    yaw = math.atan2(direction.y, direction.x) - math.pi / 2
    head_obj = box(f"{name}_head", (x, y, height + 0.2), head, frame, rotation=yaw)
    head_obj.rotation_euler[0] = math.radians(-35)
    panel = box(f"{name}_panel", (x, y, height + 0.2), (head[0] * 0.9, 0.08, head[2] * 0.8), glow, rotation=yaw)
    panel.rotation_euler[0] = math.radians(-35)
    panel.location += Vector((math.cos(yaw + math.pi / 2), math.sin(yaw + math.pi / 2), 0)) * (head[1] / 2 + 0.02)
    light = bpy.data.lights.new(f"{name}_spot", "SPOT")
    light.energy = energy
    light.spot_size = math.radians(75)
    light.spot_blend = 0.6
    light.shadow_soft_size = 0.6
    light.color = color("lamp")[:3]
    spot = bpy.data.objects.new(f"{name}_spot", light)
    spot.location = (x, y, height + 0.4)
    spot.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    link(spot)
    return Vector((x, y, height + 0.2))


def build_stand(level):
    CURRENT[0] = f"stand_{level}"
    spec = stand_spec(level)
    style = spec["style"]
    concrete = material("concrete", "concrete", roughness=0.85, noise=("concrete_dark", 2.5))
    concrete_dark = material("concrete_dark", "concrete_dark", roughness=0.85)
    steel = material("steel", "steel", roughness=0.35, metallic=0.85)
    steel_dark = material("steel_dark", "steel_dark", roughness=0.4, metallic=0.85)
    wood = material("wood", "wood", roughness=0.75, noise=("wood_dark", 6.0))
    wood_dark = material("wood_dark", "wood_dark", roughness=0.8)
    seat_grey = material("seat_grey", "seat_grey", roughness=0.5)
    seat_wine = material("seat_wine", "seat_wine", roughness=0.45, coat=0.3)
    seat_rose = material("seat_rose", "seat_rose", roughness=0.45, coat=0.3)
    gold = material("gold_trim", "gold", roughness=0.25, metallic=1.0, emission="gold", strength=0.8)
    seats = []
    lights = []
    if style == "scaffold":
        seat_mat, riser, wall, back = seat_grey, steel_dark, steel, None
    elif style == "wood":
        seat_mat, riser, wall, back = wood, wood_dark, wood_dark, None
    elif style == "steel":
        seat_mat, riser, wall, back = seat_wine, concrete_dark, steel, seat_wine
    else:
        seat_mat, riser, wall, back = seat_wine, concrete_dark, concrete, seat_rose
    for index, (start, end, rows) in enumerate(spec["segments"]):
        closed = end - start >= 360
        slab = 0.16 if style == "scaffold" else None
        seats += build_rows(f"lower{index}", BOWL_A, BOWL_B, 0.0, rows, deg(start), deg(end), seat_mat, riser, wall,
                            closed, slab=slab, seat_back=back)
        if style == "scaffold":
            # 仮設は板の下を足場の柱で支える。
            for row in range(rows):
                z = (row + 1) * ROW_RISE
                for k in range(7):
                    t = deg(start + (end - start) * (k + 0.5) / 7)
                    x, y = ring_point(BOWL_A + row * ROW_DEPTH + ROW_DEPTH * 0.8, BOWL_B + row * ROW_DEPTH +
                                      ROW_DEPTH * 0.8, t)
                    cylinder(f"leg_{index}_{row}_{k}", (x, y, z / 2), 0.05, z, steel, vertices=6)
        if style == "wood":
            for row in range(rows):
                z = (row + 1) * ROW_RISE
                for k in range(9):
                    t = deg(start + (end - start) * (k + 0.5) / 9)
                    x, y = ring_point(BOWL_A + row * ROW_DEPTH + ROW_DEPTH * 0.5, BOWL_B + row * ROW_DEPTH +
                                      ROW_DEPTH * 0.5, t)
                    box(f"post_{index}_{row}_{k}", (x, y, z / 2), (0.12, 0.12, z), wood_dark)
    lower_rows = spec["segments"][0][2]
    if spec.get("upper"):
        start, end, rows = spec["upper"]
        gap = 1.3
        base_z = lower_rows * ROW_RISE + 1.4
        a0 = BOWL_A + lower_rows * ROW_DEPTH + gap
        b0 = BOWL_B + lower_rows * ROW_DEPTH + gap
        closed = end - start >= 360
        # 上の層の下は、柱のある通路（コンコース）に見えるよう暗い壁で埋める。
        band("concourse", BOWL_A + lower_rows * ROW_DEPTH, BOWL_B + lower_rows * ROW_DEPTH, gap,
             lower_rows * ROW_RISE + 0.05, deg(start), deg(end), (concrete_dark, concrete_dark, concrete_dark),
             closed=closed)
        seats += build_rows("upper", a0, b0, base_z, rows, deg(start), deg(end), seat_rose if style == "dome" else
                            seat_wine, riser, wall, closed, seat_back=gold if style == "dome" else seat_rose)
        top_z = base_z + rows * ROW_RISE
        outer_a = a0 + rows * ROW_DEPTH
        outer_b = b0 + rows * ROW_DEPTH
        band("fascia", outer_a - 0.05, outer_b - 0.05, 0.25, top_z + 0.6, deg(start), deg(end),
             (gold, gold, concrete), closed=closed)
    else:
        top_z = lower_rows * ROW_RISE
        outer_a = BOWL_A + lower_rows * ROW_DEPTH
        outer_b = BOWL_B + lower_rows * ROW_DEPTH
    if spec.get("roof"):
        start, end = spec["roof"]
        roof = material("roof", "#d8dde8", roughness=0.4, metallic=0.3)
        led = material("roof_led", "gold_bright", emission="gold_bright", strength=6.0)
        band("roof", outer_a - 4.2, outer_b - 4.2, 4.6, top_z + 3.0, deg(start), deg(end), (roof, led, roof),
             slab=0.3)
        for k in range(12):
            t = deg(start + (end - start) * (k + 0.5) / 12)
            x, y = ring_point(outer_a + 0.1, outer_b + 0.1, t)
            cylinder(f"roof_col_{k}", (x, y, (top_z + 3.0) / 2), 0.18, top_z + 3.0, steel, vertices=8)
    # 照明塔。段が上がるほど高く、多くなる。
    if level == 1:
        towers = [(-9.0, 12.5, 6.0), (9.0, 12.5, 6.0)]
    elif level == 2:
        towers = [(-12.0, 13.5, 8.0), (12.0, 13.5, 8.0)]
    elif level == 3:
        # 奥の塔は、ななめ上から見ると絵の上端に近い。頭が切れないよう少し手前に置く。
        towers = [(-17.0, 11.5, 10.0), (17.5, 13.5, 11.0), (-20.5, -6.0, 9.5), (20.5, -6.0, 9.5)]
    elif level in (4, 5):
        towers = [(-22.5, 10.5, 12.0), (21.0, 16.0, 14.0), (-25.0, -3.0, 12.5), (25.0, -3.0, 12.5)]
    else:
        towers = []
    for index, (x, y, height) in enumerate(towers):
        lights.append(floodlight(f"tower{level}_{index}", x, y, height,
                                 energy=30000.0 + 4000.0 * level, head=(1.2 + 0.15 * level, 0.4, 0.8)))
    if style == "dome":
        dome_glass = material("dome_glass", "glass", roughness=0.05, alpha=0.1, coat=0.0)
        rib = material("dome_rib", "gold", roughness=0.3, metallic=1.0, emission="gold", strength=1.5)
        build_dome(outer_a + 0.3, outer_b + 0.3, top_z + 0.6, 6.5, dome_glass, rib)
        for index, t in enumerate(range(0, 360, 45)):
            x, y = ring_point(outer_a * 0.55, outer_b * 0.55, deg(t))
            lamp = bpy.data.lights.new(f"dome_light_{index}", "POINT")
            lamp.energy = 900.0
            lamp.color = color("lamp")[:3]
            lamp.shadow_soft_size = 1.0
            lamp_obj = bpy.data.objects.new(f"dome_light_{index}", lamp)
            lamp_obj.location = (x, y, top_z + 4.0)
            link(lamp_obj)
            lights.append(Vector((x, y, top_z + 5.0)))
    return seats, lights


def build_dome(a, b, base_z, height, glass, rib):
    """ガラスのドーム。てっぺんは丸く開け（天窓の輪）、骨組みはそこで止める。"""
    steps = 72
    rings = 10
    top = 0.62
    verts = []
    for ring in range(rings + 1):
        phi = (math.pi / 2) * top * ring / rings
        scale = math.cos(phi)
        z = base_z + height * math.sin(phi)
        for i in range(steps):
            x, y = ring_point(a * scale, b * scale, 2 * math.pi * i / steps)
            verts.append((x, y, z))
    faces = []
    for ring in range(rings):
        for i in range(steps):
            j = (i + 1) % steps
            faces.append((ring * steps + i, ring * steps + j, (ring + 1) * steps + j, (ring + 1) * steps + i))
    dome = mesh_object("dome", verts, faces, [glass])
    for polygon in dome.data.polygons:
        polygon.use_smooth = True
    for k in range(12):
        t = 2 * math.pi * (k + 0.5) / 12
        rib_verts = []
        for ring in range(rings + 1):
            phi = (math.pi / 2) * top * ring / rings
            x, y = ring_point(a * math.cos(phi), b * math.cos(phi), t)
            z = base_z + height * math.sin(phi)
            rib_verts.append((x, y, z))
        for index in range(rings):
            p, q = Vector(rib_verts[index]), Vector(rib_verts[index + 1])
            middle = (p + q) / 2
            length = (q - p).length
            obj = cylinder(f"rib_{k}_{index}", middle, 0.08, length, rib, vertices=6)
            obj.rotation_euler = (q - p).to_track_quat("Z", "Y").to_euler()
    band("dome_ring", a - 0.2, b - 0.2, 0.4, base_z + 0.2, 0, 2 * math.pi, (rib, rib, rib), closed=True, slab=0.4)
    phi = (math.pi / 2) * top
    band("dome_oculus", a * math.cos(phi) - 0.35, b * math.cos(phi) - 0.35, 0.5, base_z + height * math.sin(phi) + 0.15,
         0, 2 * math.pi, (rib, rib, rib), closed=True, slab=0.3)


# ───────────── 売店と金庫 ─────────────


def build_shop(level):
    CURRENT[0] = f"shop_{level}"
    x0, y0 = SHOP_PLOT
    pink = material("awning_pink", "awning_pink", roughness=0.6)
    white = material("awning_white", "awning_white", roughness=0.6)
    wood = material("shop_wood", "wood", roughness=0.7, noise=("wood_dark", 5.0))
    window = material("shop_window", "window", emission="window", strength=4.0)
    wall = material("shop_wall", "#f1e4d6", roughness=0.8)
    roof = material("shop_roof", "seat_wine", roughness=0.6)
    gold = material("shop_gold", "gold", roughness=0.25, metallic=1.0, emission="gold", strength=0.6)
    glass = material("shop_glass", "glass", roughness=0.05, alpha=0.35, emission="window", strength=1.2)
    lamp = material("shop_lamp", "lamp", emission="lamp", strength=10.0)
    lights = []

    def awning(cx, cy, width, depth, z, stripes=6):
        for k in range(stripes):
            stripe = box(f"awning_{cx}_{k}", (cx - width / 2 + width * (k + 0.5) / stripes, cy - depth / 2, z),
                         (width / stripes, depth, 0.12), pink if k % 2 == 0 else white)
            stripe.rotation_euler[0] = math.radians(-18)

    def warm_light(name, cx, cy, z, energy):
        light = bpy.data.lights.new(name, "POINT")
        light.energy = energy
        light.color = color("window")[:3]
        light.shadow_soft_size = 0.4
        obj = bpy.data.objects.new(name, light)
        obj.location = (cx, cy, z)
        link(obj)
        lights.append(Vector((cx, cy, z)))

    if level == 1:
        # 屋台: 車輪のついた小さな屋台と、ちょうちん。
        box("cart", (x0, y0, 0.9), (2.6, 1.4, 1.0), wood, bevel=0.06)
        for side in (-1, 1):
            cylinder(f"wheel_{side}", (x0 + side * 0.9, y0 - 0.75, 0.45), 0.42, 0.12,
                     material("wheel", "steel_dark", metallic=0.8, roughness=0.4), vertices=16,
                     rotation=(math.radians(90), 0, 0))
        for px in (-1.2, 1.2):
            cylinder(f"cart_post_{px}", (x0 + px, y0 - 0.5, 1.9), 0.05, 1.8, wood, vertices=6)
        awning(x0, y0, 3.0, 1.6, 2.85)
        sphere("lantern", (x0 + 1.5, y0 - 1.0, 2.2), 0.22, lamp, segments=10, rings=6, scale=(1, 1, 1.3))
        warm_light("shop_light_1", x0, y0 - 1.2, 2.3, 60.0)
    elif level == 2:
        box("kiosk", (x0, y0 + 0.3, 1.3), (4.4, 3.0, 2.6), wall, bevel=0.06)
        box("kiosk_roof", (x0, y0 + 0.3, 2.75), (4.8, 3.4, 0.3), roof, bevel=0.05)
        box("kiosk_window", (x0, y0 - 1.21, 1.5), (3.4, 0.05, 1.1), window)
        box("kiosk_counter", (x0, y0 - 1.5, 0.95), (3.8, 0.6, 0.12), wood)
        box("kiosk_sign", (x0, y0 - 1.05, 3.25), (3.0, 0.15, 0.7), gold, bevel=0.03)
        awning(x0, y0 - 1.3, 4.6, 1.4, 2.35, stripes=8)
        for side in (-1, 1):
            cylinder(f"stool_{side}", (x0 + side * 1.2, y0 - 2.4, 0.35), 0.25, 0.7, wood, vertices=10)
        warm_light("shop_light_2", x0, y0 - 2.0, 2.6, 110.0)
    elif level == 3:
        for k, offset in enumerate((-3.0, 0.0, 3.0)):
            cx = x0 + offset
            box(f"stall_{k}", (cx, y0 + 1.2, 1.25), (2.7, 2.4, 2.5), wall, bevel=0.05)
            box(f"stall_window_{k}", (cx, y0 - 0.01, 1.4), (2.0, 0.05, 1.0), window)
            box(f"stall_sign_{k}", (cx, y0 + 0.05, 2.75), (2.2, 0.12, 0.5), gold if k == 1 else pink)
            awning(cx, y0 - 0.1, 2.8, 1.2, 2.25, stripes=6)
        box("court_roof", (x0, y0 + 1.2, 2.62), (9.0, 2.8, 0.25), roof, bevel=0.04)
        for k, (tx, ty) in enumerate(((-3.0, -2.6), (0.0, -2.8), (3.0, -2.6))):
            cylinder(f"table_{k}", (x0 + tx, y0 + ty, 0.75), 0.6, 0.08, wood, vertices=14)
            cylinder(f"table_leg_{k}", (x0 + tx, y0 + ty, 0.38), 0.06, 0.75, wood, vertices=6)
            cylinder(f"umbrella_pole_{k}", (x0 + tx, y0 + ty, 1.4), 0.04, 1.4, wood, vertices=6)
            cone(f"umbrella_{k}", (x0 + tx, y0 + ty, 1.75), 1.0, 0.55, pink if k != 1 else white, vertices=12)
        for k in range(3):
            warm_light(f"shop_light_3_{k}", x0 - 3.0 + 3.0 * k, y0 - 1.0, 2.4, 90.0)
    else:
        # ラウンジ: 2階建てのガラス張りに金の縁。
        box("lounge_floor1", (x0, y0 + 0.4, 1.4), (8.6, 4.8, 2.8), glass)
        box("lounge_core", (x0, y0 + 1.4, 1.4), (8.0, 2.6, 2.7), wall)
        box("lounge_slab", (x0, y0 + 0.4, 2.9), (9.2, 5.4, 0.25), wall, bevel=0.05)
        box("lounge_floor2", (x0 + 0.6, y0 + 0.8, 4.3), (6.8, 3.8, 2.6), glass)
        box("lounge_core2", (x0 + 0.6, y0 + 1.6, 4.3), (6.2, 2.0, 2.5), wall)
        box("lounge_roof", (x0 + 0.6, y0 + 0.8, 5.72), (7.4, 4.4, 0.25), roof, bevel=0.05)
        for z in (2.78, 5.6):
            box(f"lounge_trim_{z}", (x0, y0 - 2.0 if z < 3 else y0 - 1.13, z), (9.2 if z < 3 else 7.4, 0.12, 0.12),
                gold)
        box("lounge_sign", (x0 + 0.6, y0 - 1.15, 6.25), (4.2, 0.15, 0.8), gold, bevel=0.04)
        for k, tx in enumerate((-3.4, -1.2, 1.2, 3.4)):
            cylinder(f"terrace_table_{k}", (x0 + tx, y0 - 3.0, 0.7), 0.45, 0.06, gold, vertices=12)
        for k in range(4):
            warm_light(f"shop_light_4_{k}", x0 - 3.0 + 2.0 * k, y0, 2.0 + (k % 2) * 2.6, 120.0)
    return lights


def build_vault(level):
    CURRENT[0] = f"vault_{level}"
    x0, y0 = VAULT_PLOT
    safe = material("safe", "safe", roughness=0.3, metallic=0.9)
    safe_dark = material("safe_dark", "safe_dark", roughness=0.35, metallic=0.9)
    gold = material("vault_gold", "gold", roughness=0.2, metallic=1.0, emission="gold", strength=1.2)
    coin = material("coin", "gold_bright", roughness=0.2, metallic=1.0, emission="gold", strength=0.6)
    stone = material("vault_stone", "#d9d2c4", roughness=0.75, noise=("#bdb4a3", 3.0))
    wood = material("vault_wood", "wood", roughness=0.7)
    roof = material("vault_roof", "steel_dark", roughness=0.5, metallic=0.6)
    lights = []

    def coins(cx, cy, count, spread, z0=0.07):
        rng = random.Random(level * 31 + count)
        for k in range(count):
            angle = rng.uniform(0, 2 * math.pi)
            radius = rng.uniform(0, spread)
            stack = rng.randint(1, 4)
            for s in range(stack):
                cylinder(f"coin_{level}_{k}_{s}", (cx + radius * math.cos(angle), cy + radius * math.sin(angle),
                                                   z0 + 0.05 + 0.09 * s), 0.28, 0.08, coin, vertices=14)

    def glow_light(name, cx, cy, z, energy):
        light = bpy.data.lights.new(name, "POINT")
        light.energy = energy
        light.color = color("gold_bright")[:3]
        light.shadow_soft_size = 0.5
        obj = bpy.data.objects.new(name, light)
        obj.location = (cx, cy, z)
        link(obj)
        lights.append(Vector((cx, cy, z)))

    if level == 1:
        box("vault_table", (x0, y0, 0.55), (2.4, 1.6, 0.12), wood, bevel=0.03)
        for dx in (-1.0, 1.0):
            for dy in (-0.6, 0.6):
                cylinder(f"table_leg_{dx}_{dy}", (x0 + dx, y0 + dy, 0.27), 0.06, 0.55, wood, vertices=6)
        box("cashbox", (x0, y0, 0.86), (1.1, 0.7, 0.5), safe, bevel=0.04)
        box("cashbox_handle", (x0, y0, 1.18), (0.5, 0.08, 0.12), safe_dark)
        coins(x0 + 1.6, y0 - 0.8, 4, 0.5)
        glow_light("vault_light_1", x0, y0 - 1.2, 2.0, 50.0)
    elif level == 2:
        box("safe_body", (x0, y0, 1.2), (2.0, 1.8, 2.4), safe, bevel=0.08)
        box("safe_door", (x0, y0 - 0.92, 1.25), (1.6, 0.08, 1.9), safe_dark, bevel=0.04)
        cylinder("safe_dial", (x0 + 0.2, y0 - 0.99, 1.45), 0.28, 0.08, gold, vertices=20,
                 rotation=(math.radians(90), 0, 0))
        cylinder("safe_handle", (x0 - 0.4, y0 - 0.99, 1.1), 0.06, 0.6, gold, vertices=8)
        coins(x0 + 1.9, y0 - 1.5, 7, 0.9)
        glow_light("vault_light_2", x0, y0 - 2.0, 2.6, 80.0)
    elif level == 3:
        box("vault_house", (x0, y0 + 0.6, 1.8), (6.0, 4.0, 3.6), stone, bevel=0.06)
        box("vault_house_roof", (x0, y0 + 0.6, 3.75), (6.6, 4.6, 0.35), roof, bevel=0.05)
        cylinder("vault_round_door", (x0, y0 - 1.45, 1.6), 1.25, 0.25, safe, vertices=36,
                 rotation=(math.radians(90), 0, 0))
        cylinder("vault_door_ring", (x0, y0 - 1.6, 1.6), 0.9, 0.08, gold, vertices=36,
                 rotation=(math.radians(90), 0, 0))
        for k in range(6):
            angle = 2 * math.pi * k / 6
            cylinder(f"vault_spoke_{k}", (x0 + 0.5 * math.cos(angle), y0 - 1.68, 1.6 + 0.5 * math.sin(angle)), 0.05,
                     0.5, gold, vertices=6, rotation=(0, math.pi / 2 - angle, 0))
        coins(x0 - 2.0, y0 - 2.6, 9, 0.9)
        coins(x0 + 2.2, y0 - 2.4, 7, 0.8)
        glow_light("vault_light_3", x0, y0 - 2.8, 3.0, 140.0)
    else:
        # 金庫室: 柱の並ぶ銀行の建物と、開いた金の扉。
        box("bank_base", (x0, y0 + 0.4, 0.3), (9.4, 6.4, 0.6), stone, bevel=0.05)
        box("bank_body", (x0, y0 + 1.2, 2.6), (8.4, 4.4, 4.0), stone, bevel=0.05)
        box("bank_roof", (x0, y0 + 0.9, 4.85), (9.4, 5.6, 0.5), stone, bevel=0.06)
        pediment_verts = [(-4.7, 0, 0), (4.7, 0, 0), (0, 0, 1.4), (-4.7, 0.4, 0), (4.7, 0.4, 0), (0, 0.4, 1.4)]
        pediment = mesh_object("bank_pediment", pediment_verts,
                               [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], [stone])
        pediment.location = (x0, y0 - 1.9, 5.1)
        box("bank_gold_line", (x0, y0 - 1.95, 5.08), (9.4, 0.1, 0.14), gold)
        for k in range(6):
            cylinder(f"bank_column_{k}", (x0 - 3.9 + 1.56 * k, y0 - 1.5, 2.6), 0.32, 4.0, stone, vertices=16)
        box("bank_door_frame", (x0, y0 - 1.0, 1.9), (2.6, 0.2, 3.0), gold, bevel=0.04)
        cylinder("bank_vault_door", (x0 - 1.0, y0 - 1.6, 1.8), 1.1, 0.25, gold, vertices=36,
                 rotation=(math.radians(90), 0, math.radians(-40)))
        box("bank_door_glow", (x0, y0 - 0.88, 1.8), (2.2, 0.05, 2.6),
            material("bank_glow", "gold_bright", emission="gold_bright", strength=8.0))
        coins(x0 - 3.0, y0 - 3.2, 10, 1.0, z0=0.0)
        coins(x0 + 3.0, y0 - 3.2, 10, 1.0, z0=0.0)
        glow_light("vault_light_4", x0, y0 - 2.6, 2.5, 220.0)
    return lights


def scale_collection(name, center, factor, points=()):
    """区画の中心を基準に、集まりの中の物をまとめて大きくする（光の強さも面積に合わせる）。"""
    cx, cy = center
    for obj in collection(name).objects:
        obj.location = (cx + (obj.location.x - cx) * factor, cy + (obj.location.y - cy) * factor,
                        obj.location.z * factor)
        obj.scale = obj.scale * factor
        if obj.type == "LIGHT":
            obj.data.energy *= factor ** 2
    return [Vector((cx + (p.x - cx) * factor, cy + (p.y - cy) * factor, p.z * factor)) for p in points]


def build_scaffold(kind):
    CURRENT[0] = f"scaffold_{kind}"
    pipe = material("scaffold_pipe", "#f2c14e", roughness=0.4, metallic=0.6)
    net = material("scaffold_net", "#3b8fd9", roughness=0.8, alpha=0.55)
    if kind == "stand":
        cx, cy, rx, ry, height = 0.0, 0.0, 22.0, 17.5, 9.0
        posts = 26
        for k in range(posts):
            t = 2 * math.pi * k / posts
            x, y = ring_point(rx, ry, t)
            cylinder(f"sc_post_{k}", (x, y, height / 2), 0.08, height, pipe, vertices=6)
        for z in (2.0, 4.5, 7.0, height):
            band(f"sc_rail_{z}", rx - 0.05, ry - 0.05, 0.1, z, 0, 2 * math.pi, (pipe, pipe, pipe), closed=True,
                 slab=0.1)
        band("sc_net", rx, ry, 0.02, 7.0, deg(200), deg(340), (net, net, net), slab=5.0)
        crane(-16.0, 15.0, 16.0, pipe)
    else:
        cx, cy = SHOP_PLOT if kind == "shop" else VAULT_PLOT
        width, depth, height = 11.0, 7.6, 8.4
        for dx in (-1, 0, 1):
            for dy in (-1, 1):
                cylinder(f"sc_{kind}_post_{dx}_{dy}", (cx + dx * width / 2, cy + dy * depth / 2, height / 2), 0.07,
                         height, pipe, vertices=6)
        for z in (1.8, 3.8, height):
            for dy in (-1, 1):
                box(f"sc_{kind}_rail_{z}_{dy}", (cx, cy + dy * depth / 2, z), (width, 0.1, 0.1), pipe)
            for dx in (-1, 1):
                box(f"sc_{kind}_rail_{z}_x{dx}", (cx + dx * width / 2, cy, z), (0.1, depth, 0.1), pipe)
        box(f"sc_{kind}_net", (cx, cy - depth / 2 - 0.05, 3.4), (width, 0.04, 4.6), net)
        crane(cx + (3.5 if kind == "shop" else -3.5), cy + 3.5, 9.0, pipe)


def crane(x, y, height, pipe):
    cylinder(f"crane_mast_{x}", (x, y, height / 2), 0.25, height, pipe, vertices=8)
    jib = box(f"crane_jib_{x}", (x + (4.0 if x < 0 else -4.0), y, height), (9.0, 0.35, 0.35), pipe)
    box(f"crane_counter_{x}", (x - (2.2 if x < 0 else -2.2), y, height - 0.3), (1.2, 0.8, 0.8),
        material("crane_weight", "steel_dark", metallic=0.6, roughness=0.5))
    hook_x = x + (6.5 if x < 0 else -6.5)
    cylinder(f"crane_cable_{x}", (hook_x, y, height - 1.6), 0.03, 3.2,
             material("cable", "#222222", roughness=0.6), vertices=4)
    box(f"crane_load_{x}", (hook_x, y, height - 3.4), (1.4, 0.9, 0.4), material("load", "seat_wine", roughness=0.6))
    return jib


# ───────────── 描き出し ─────────────


def set_visible(names, shadow_catchers=()):
    """描く層だけを残す。除外した集まりは評価からも外れるので、客席の見え方の判定にも効く。"""
    layers = bpy.context.view_layer.layer_collection.children
    for name in COLLECTIONS:
        visible = name in names or name == "lights" or (name == "catchers" and bool(shadow_catchers))
        layers[name].exclude = not visible
    for obj in collection("catchers").objects:
        obj.hide_render = obj not in shadow_catchers
    bpy.context.view_layer.update()


def project(scene, camera, point):
    coords = world_to_camera_view(scene, camera, point)
    return [round(coords.x, 4), round(1 - coords.y, 4), coords.z]


def visible_seats(scene, camera, seats):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    forward = -camera.matrix_world.to_3x3().col[2].normalized()
    kept = []
    for point in seats:
        origin = point - forward * 150.0
        visible = True
        for _ in range(6):
            hit, location, _normal, _index, obj, _matrix = scene.ray_cast(depsgraph, origin, forward)
            if not hit or (location - point).length < 0.35:
                break
            # ドームのガラスと骨組みは透けて見えるので、その先を調べる。
            if obj and (obj.name.startswith("dome") or obj.name.startswith("rib_")):
                origin = location + forward * 0.02
                continue
            visible = False
            break
        if visible:
            kept.append(point)
    return kept


def render(scene, path):
    scene.render.filepath = path
    settings = scene.render.image_settings
    if path.endswith(".webp"):
        settings.file_format = "WEBP"
        settings.color_mode = "RGBA"
        settings.quality = 86
    else:
        settings.file_format = "PNG"
        settings.color_mode = "RGBA"
    bpy.ops.render.render(write_still=True)
    print("rendered", path)


def shadow_catcher(name, center, size):
    CURRENT[0] = "catchers"
    obj = box(name, (center[0], center[1], 0.05), (size[0] + 1.5, size[1] + 1.5, 0.02),
              material("catcher", "#808080"))
    obj.is_shadow_catcher = True
    return obj


def main():
    scene = reset_scene()
    build_plinth()
    build_lights()
    camera = build_camera(scene)
    stand_data = {}
    for level in range(1, 7):
        seats, lights = build_stand(level)
        stand_data[level] = (seats, lights)
    shop_lights = {}
    vault_lights = {}
    for level in range(1, 5):
        shop_lights[level] = scale_collection(f"shop_{level}", SHOP_PLOT, FACILITY_SCALE, build_shop(level))
        vault_lights[level] = scale_collection(f"vault_{level}", VAULT_PLOT, FACILITY_SCALE, build_vault(level))
    for kind in ("stand", "shop", "vault"):
        build_scaffold(kind)
    shop_catcher = shadow_catcher("shop_catcher", SHOP_PLOT, PLOT_SIZE)
    vault_catcher = shadow_catcher("vault_catcher", VAULT_PLOT, PLOT_SIZE)

    if MODE == "preview":
        names = {"base", f"stand_{STAND}", f"shop_{SHOP}", f"vault_{VAULT}"}
        if ONLY:
            names = {"base", ONLY}
        set_visible(names)
        os.makedirs(OUT, exist_ok=True)
        tag = arg("--tag", "")
        render(scene, os.path.join(OUT, f"preview-s{STAND}-h{SHOP}-v{VAULT}{'-' + ONLY if ONLY else ''}"
                                        f"{'-' + tag if tag else ''}.png"))
        return

    os.makedirs(OUT, exist_ok=True)
    meta = {
        "width": WIDTH,
        "height": HEIGHT,
        "camera": CAMERA,
        "seatRadius": round(0.24 / bpy.data.cameras["camera"].ortho_scale, 5),
        "stand": {},
        "shop": {},
        "vault": {},
        "anchors": {},
    }
    wanted = set(ONLY.split(",")) if ONLY else None

    def want(name):
        return wanted is None or name in wanted

    for level in range(1, 7):
        seats, lights = stand_data[level]
        set_visible({"base", f"stand_{level}"})
        bpy.context.view_layer.update()
        kept = visible_seats(scene, camera, seats)
        projected = sorted((project(scene, camera, point) for point in kept), key=lambda item: -item[2])
        meta["stand"][str(level)] = {
            "image": f"base-stand-{level}.webp",
            "name": STAND_NAMES[level - 1],
            "seats": [[x, y] for x, y, _ in projected],
            "lights": [project(scene, camera, point)[:2] for point in lights],
        }
        if want(f"base-stand-{level}"):
            render(scene, os.path.join(OUT, f"base-stand-{level}.webp"))
    for kind, catcher, count, light_map in (("shop", shop_catcher, 4, shop_lights),
                                            ("vault", vault_catcher, 4, vault_lights)):
        for level in range(1, count + 1):
            set_visible({f"{kind}_{level}"}, shadow_catchers=(catcher,))
            meta[kind][str(level)] = {
                "image": f"{kind}-{level}.webp",
                "lights": [project(scene, camera, point)[:2] for point in light_map[level]],
            }
            if want(f"{kind}-{level}"):
                render(scene, os.path.join(OUT, f"{kind}-{level}.webp"))
    for kind in ("stand", "shop", "vault"):
        catchers = () if kind == "stand" else ((shop_catcher,) if kind == "shop" else (vault_catcher,))
        set_visible({f"scaffold_{kind}"}, shadow_catchers=catchers)
        if want(f"scaffold-{kind}"):
            render(scene, os.path.join(OUT, f"scaffold-{kind}.webp"))
    # 施設の場所（建設の演出で光らせる範囲）。
    for name, (x, y), size in (("shop", SHOP_PLOT, PLOT_SIZE), ("vault", VAULT_PLOT, PLOT_SIZE),
                               ("stand", (0.0, 0.0), (48.0, 40.0))):
        corners = [Vector((x + dx * size[0] / 2, y + dy * size[1] / 2, z)) for dx in (-1, 1) for dy in (-1, 1)
                   for z in (0.0, 8.0 if name != "stand" else 16.0)]
        points = [project(scene, camera, corner) for corner in corners]
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        meta["anchors"][name] = {"x": round(min(xs), 4), "y": round(min(ys), 4), "w": round(max(xs) - min(xs), 4),
                                 "h": round(max(ys) - min(ys), 4)}
    with open(os.path.join(OUT, "stadium-art.json"), "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, separators=(",", ":"))
    print("wrote", os.path.join(OUT, "stadium-art.json"))


main()
