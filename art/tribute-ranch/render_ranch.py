# お貢ぎ牧場の牧場経営（設計書16.8）: 牧場の絵を Blender で描く。
# やわらかい箱庭の絵柄（輪郭線なし・やわらかい影・暖かい日差し・パステル寄り・丸いおもちゃのような動物）。
#
#   blender -b --factory-startup -P art/tribute-ranch/render_ranch.py -- <出力フォルダ> <day|evening|night|layout>
#
# 1回の実行で、その時間帯の絵をすべて描く。
#   ranch-lv{1..10}-{時間帯}.webp   芝の島と、そのレベルまでの施設（背景は透明。空は画面側で描く）
#   {cow|pig|sheep}-{stand|walk1|walk2|eat|sleep}-{時間帯}.webp   動物（足元が絵の決まった位置に来る）
#   prop-{letter|hay|stake}-{時間帯}.webp   小物
# layout を渡すと、何も描かずに、動物の立ち位置と足元の位置を画面の割合で書き出す（tribute-core.mjs に写す）。
import json
import math
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "."
TIME = argv[1] if len(argv) > 1 else "day"
LAYOUT_ONLY = TIME == "layout"
if LAYOUT_ONLY:
    TIME = "day"

SCENE_W, SCENE_H = 960, 600
SCENE_ORTHO = 12.0
SPRITE_PX = 256
SPRITE_ORTHO = 2.9
CAMERA_DIR = Vector((-11, 11, -9.2)).normalized()

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue

MATS = {}


def mat(name, color, rough=0.55, sheen=0.0, noise=None, emission=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    if sheen:
        bsdf.inputs["Sheen Weight"].default_value = sheen
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Strength"].default_value = emission
    if noise:
        color2, scale = noise
        tex = nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = scale
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.42
        ramp.color_ramp.elements[0].color = (*color, 1)
        ramp.color_ramp.elements[1].position = 0.62
        ramp.color_ramp.elements[1].color = (*color2, 1)
        links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    MATS[name] = m
    return m


# 夜は窓の灯りを強める（昼は弱い光）。
WINDOW_GLOW = {"day": 0.0, "evening": 1.5, "night": 4.0}[TIME]


def finish(obj, material, smooth=True):
    obj.data.materials.append(material)
    if smooth:
        for poly in obj.data.polygons:
            poly.use_smooth = True
    return obj


def link(obj, parent, group):
    if parent:
        obj.parent = parent
    if group is not None:
        group.append(obj)
    return obj


def sphere(loc, scale, material, parent=None, group=None, seg=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, location=loc)
    obj = bpy.context.active_object
    obj.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    finish(obj, material)
    return link(obj, parent, group)


def rcyl(loc, radius, depth, material, rot=(0, 0, 0), parent=None, group=None, vertices=24, round_ratio=0.45):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot)
    obj = bpy.context.active_object
    bev = obj.modifiers.new("round", "BEVEL")
    bev.width = min(radius, depth) * round_ratio
    bev.segments = 5
    finish(obj, material)
    return link(obj, parent, group)


def rcube(loc, size, material, rot=(0, 0, 0), parent=None, group=None, round_width=0.06):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    bev = obj.modifiers.new("round", "BEVEL")
    bev.width = round_width
    bev.segments = 5
    finish(obj, material)
    return link(obj, parent, group)


def rcone(loc, r1, depth, material, rot=(0, 0, 0), parent=None, group=None, tip=0.25, vertices=20):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r1 * tip, depth=depth, location=loc, rotation=rot)
    obj = bpy.context.active_object
    bev = obj.modifiers.new("round", "BEVEL")
    bev.width = r1 * 0.25
    bev.segments = 4
    finish(obj, material)
    return link(obj, parent, group)


def mesh_object(name, verts, faces, material, group):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish(obj, material, smooth=False)
    return link(obj, None, group)


def empty(loc, rot=(0, 0, 0), parent=None, group=None):
    bpy.ops.object.empty_add(location=loc, rotation=rot)
    return link(bpy.context.active_object, parent, group)


# ───────────── 動物 ─────────────
# しぐさ: stand（立つ）・walk1/walk2（歩く2コマ）・eat（頭を下げて食べる）・sleep（伏せて眠る）。
# 足元は原点。顔は +x を向く（向きは置く時に回す）。

def face(head, r, group, closed=False, spread=0.34, height=0.08):
    black = mat("eye", (0.04, 0.03, 0.04), 0.15)
    shine = mat("shine", (1, 1, 1), 0.2, emission=2.0)
    cheek = mat("cheek", (1.0, 0.55, 0.62), 0.8)
    for side in (-1, 1):
        x = r * 0.9
        y = side * r * spread
        z = r * height
        if closed:
            # 閉じた目: 細い横線
            rcube((x, y, z - 0.01), (0.012, 0.07, 0.012), black, parent=head, group=group, round_width=0.01)
        else:
            sphere((x, y, z), (0.05, 0.075, 0.095), black, head, group, seg=16)
            sphere((x + 0.04, y + 0.02, z + 0.035), (0.02, 0.022, 0.022), shine, head, group, seg=8)
        sphere((r * 0.8, side * r * 0.62, -r * 0.2), (0.04, 0.1, 0.06), cheek, head, group, seg=12)


def legs(root, group, sx, sy, color, hoof, height, pose):
    if pose == "sleep":
        # 伏せている時は、脚を体の下にたたんで見せない
        return
    for ix in (-1, 1):
        for iy in (-1, 1):
            lift = 0.0
            if pose in ("walk1", "walk2"):
                # 対角の2本ずつ、交互に持ち上げる（正面に近い向きでも歩いて見えるように）
                lift = 0.1 if (ix == iy) == (pose == "walk1") else 0.0
            pivot = empty((ix * sx, iy * sy, height + 0.03 + lift), parent=root, group=group)
            rcyl((0, 0, -height / 2), 0.14, height, color, parent=pivot, group=group)
            rcyl((0, 0, -height + 0.03), 0.145, 0.12, hoof, parent=pivot, group=group)


def head_pivot(root, group, neck, pose):
    """頭の付け根。食べる時は頭を下げて少し前へ、眠る時は少し下げる。"""
    x, y, z = neck
    if pose == "eat":
        return empty((x + 0.1, y, z - 0.34), rot=(0, math.radians(18), 0), parent=root, group=group)
    if pose == "sleep":
        return empty((x, y, z - 0.08), rot=(0, math.radians(8), 0), parent=root, group=group)
    return empty(neck, parent=root, group=group)


def body_lift(pose):
    """体の高さ。歩く時は少し弾み、眠る時は伏せる。"""
    return {"sleep": -0.22, "walk1": 0.05, "walk2": 0.0}.get(pose, 0.0)


def cow(pose, group):
    root = empty((0, 0, 0), group=group)
    white = mat("cow_white", (0.97, 0.95, 0.92), 0.6, sheen=0.3)
    patch = mat("cow_patch", (0.33, 0.25, 0.22), 0.6)
    muzzle = mat("cow_muzzle", (1.0, 0.76, 0.76), 0.5)
    horn = mat("horn", (1.0, 0.92, 0.72), 0.4)
    hoof = mat("hoof", (0.5, 0.36, 0.3), 0.5)
    lift = body_lift(pose)
    body = empty((0, 0, lift), parent=root, group=group)
    sphere((0, 0, 0.78), (0.82, 0.62, 0.55), white, body, group)
    sphere((0.05, -0.5, 0.95), (0.3, 0.16, 0.24), patch, body, group)
    sphere((-0.45, 0.42, 0.9), (0.24, 0.24, 0.2), patch, body, group)
    legs(body, group, 0.42, 0.3, white, hoof, 0.34, pose)
    neck = head_pivot(body, group, (0.55, 0, 1.0), pose)
    head = empty((0.23, 0, 0.3), parent=neck, group=group)
    sphere((0, 0, 0), (0.62, 0.62, 0.56), white, head, group)
    sphere((0.42, 0, -0.18), (0.26, 0.4, 0.22), muzzle, head, group)
    for side in (-1, 1):
        sphere((0.66, side * 0.13, -0.15), (0.025, 0.05, 0.035), mat("nostril", (0.7, 0.4, 0.42)), head, group, seg=8)
        rcone((-0.08, side * 0.38, 0.6), 0.08, 0.26, horn, rot=(side * -0.45, 0, 0), parent=head, group=group)
        sphere((-0.12, side * 0.7, 0.2), (0.13, 0.26, 0.08), white, head, group)
        sphere((-0.09, side * 0.71, 0.2), (0.08, 0.17, 0.04), muzzle, head, group)
    face(head, 0.62, group, closed=pose == "sleep")
    sphere((0.92, 0, 0.82), (0.12, 0.12, 0.12), mat("bell", (1.0, 0.8, 0.35), 0.25), body, group)
    rcyl((0.9, 0, 0.93), 0.36, 0.08, mat("collar", (0.98, 0.42, 0.62), 0.45), rot=(0, math.radians(68), 0), parent=body, group=group)
    return root


def pig(pose, group):
    root = empty((0, 0, 0), group=group)
    skin = mat("pig_skin", (1.0, 0.62, 0.7), 0.55, sheen=0.2)
    snout = mat("pig_snout", (1.0, 0.52, 0.62), 0.5)
    hoof = mat("pig_hoof", (0.75, 0.45, 0.5), 0.5)
    lift = body_lift(pose)
    body = empty((0, 0, lift), parent=root, group=group)
    sphere((0, 0, 0.7), (0.74, 0.62, 0.55), skin, body, group)
    legs(body, group, 0.36, 0.28, skin, hoof, 0.3, pose)
    neck = head_pivot(body, group, (0.45, 0, 0.85), pose)
    head = empty((0.23, 0, 0.27), parent=neck, group=group)
    sphere((0, 0, 0), (0.6, 0.6, 0.55), skin, head, group)
    rcyl((0.57, 0, -0.12), 0.2, 0.18, snout, rot=(0, math.radians(90), 0), parent=head, group=group)
    for side in (-1, 1):
        sphere((0.67, side * 0.07, -0.12), (0.02, 0.035, 0.055), mat("pig_nostril", (0.6, 0.28, 0.35)), head, group, seg=8)
        rcone((-0.13, side * 0.38, 0.54), 0.17, 0.26, skin, rot=(side * -0.3, 0.35, 0), parent=head, group=group)
    face(head, 0.6, group, closed=pose == "sleep")
    bpy.ops.mesh.primitive_torus_add(major_radius=0.1, minor_radius=0.035, location=(-0.76, 0, 0.88), rotation=(0, math.radians(90), 0))
    link(finish(bpy.context.active_object, skin), body, group)
    return root


def sheep(pose, group):
    root = empty((0, 0, 0), group=group)
    wool = mat("wool", (1.0, 0.98, 0.95), 0.9, sheen=0.6)
    skin = mat("sheep_face", (0.92, 0.8, 0.7), 0.55)
    hoof = mat("sheep_hoof", (0.45, 0.35, 0.32), 0.5)
    lift = body_lift(pose)
    body = empty((0, 0, lift), parent=root, group=group)
    for x, y, z, r in [
        (0, 0, 0.8, 0.52), (0.3, 0.24, 0.85, 0.36), (0.3, -0.24, 0.85, 0.36), (-0.32, 0.24, 0.82, 0.36),
        (-0.32, -0.24, 0.82, 0.36), (0, 0.36, 0.76, 0.33), (0, -0.36, 0.76, 0.33), (0.05, 0, 1.13, 0.36), (-0.3, 0, 1.06, 0.32),
    ]:
        sphere((x, y, z), (r, r, r * 0.92), wool, body, group, seg=24)
    legs(body, group, 0.3, 0.22, skin, hoof, 0.32, pose)
    neck = head_pivot(body, group, (0.4, 0, 0.95), pose)
    head = empty((0.2, 0, 0.23), parent=neck, group=group)
    sphere((0, 0, 0), (0.42, 0.4, 0.42), skin, head, group)
    for dx, dy in [(-0.05, 0), (-0.02, 0.18), (-0.02, -0.18), (-0.15, 0.08), (-0.15, -0.08)]:
        sphere((dx, dy, 0.34), (0.16, 0.16, 0.13), wool, head, group, seg=16)
    for side in (-1, 1):
        sphere((-0.08, side * 0.46, 0.07), (0.1, 0.2, 0.06), skin, head, group)
    face(head, 0.42, group, closed=pose == "sleep", spread=0.4)
    return root


ANIMALS = {"cow": cow, "pig": pig, "sheep": sheep}
POSES = ("stand", "walk1", "walk2", "eat", "sleep")


# ───────────── 小物 ─────────────

def prop_letter(group):
    # 見る人の方へ向けた封筒（桃色の封蝋つき）
    root = empty((0, 0, 0.9), rot=(0, 0, math.radians(-45)), group=group)
    rcube((0, 0, 0), (0.05, 0.42, 0.3), mat("paper", (1.0, 0.98, 0.94), 0.5), parent=root, group=group, round_width=0.03)
    sphere((0.06, 0, 0.02), (0.03, 0.09, 0.08), mat("seal_pink", (0.98, 0.36, 0.56), 0.35), root, group, seg=16)
    return root


def prop_hay(group):
    root = empty((0, 0, 0), group=group)
    hay = mat("hay", (0.98, 0.84, 0.42), 0.8, noise=((0.9, 0.74, 0.34), 14))
    for x, y, z, r in [(0, 0, 0.18, 0.36), (0.22, 0.15, 0.14, 0.25), (-0.2, -0.12, 0.14, 0.24), (0.05, -0.22, 0.12, 0.22), (-0.05, 0.05, 0.38, 0.2)]:
        sphere((x, y, z), (r, r, r * 0.75), hay, root, group, seg=16)
    return root


def prop_stake(group):
    root = empty((0, 0, 0), group=group)
    wood = mat("wood", (0.86, 0.66, 0.46), 0.7, noise=((0.78, 0.58, 0.4), 10))
    rcyl((0, 0, 0.45), 0.09, 0.9, wood, parent=root, group=group)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.12, minor_radius=0.03, location=(0, 0, 0.62))
    link(finish(bpy.context.active_object, mat("rope", (0.95, 0.5, 0.62), 0.6)), root, group)
    return root


PROPS = {"letter": prop_letter, "hay": prop_hay, "stake": prop_stake}


# ───────────── 芝の島と施設 ─────────────

def tree(loc, scale, group):
    trunk = mat("trunk", (0.6, 0.42, 0.3), 0.75, noise=((0.52, 0.36, 0.26), 12))
    leaf = mat("leaf", (0.2, 0.58, 0.26), 0.7, sheen=0.2, noise=((0.16, 0.5, 0.22), 4))
    x, y, z = loc
    rcyl((x, y, z + 0.6 * scale), 0.2 * scale, 1.2 * scale, trunk, group=group)
    for dx, dy, dz, r in [(0, 0, 1.65, 0.75), (0.35, 0.2, 1.4, 0.55), (-0.35, -0.15, 1.45, 0.55), (0.05, -0.3, 2.05, 0.5), (-0.1, 0.32, 1.95, 0.5)]:
        sphere((x + dx * scale, y + dy * scale, z + dz * scale), (r * scale, r * scale, r * scale * 0.9), leaf, group=group, seg=24)


def island(group):
    grass = mat("grass", (0.36, 0.7, 0.24), 0.85, noise=((0.3, 0.62, 0.2), 3.5))
    soil = mat("soil", (0.62, 0.42, 0.26), 0.9, noise=((0.55, 0.36, 0.22), 6))
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=4.4, depth=0.6, location=(0, 0, -0.3))
    ground = bpy.context.active_object
    ground.scale = (1.3, 1.0, 1.0)
    bpy.ops.object.transform_apply(scale=True)
    bev = ground.modifiers.new("round", "BEVEL")
    bev.width = 0.25
    bev.segments = 8
    link(finish(ground, soil, smooth=False), None, group)
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=4.35, depth=0.12, location=(0, 0, 0.0))
    top = bpy.context.active_object
    top.scale = (1.3, 1.0, 1.0)
    bpy.ops.object.transform_apply(scale=True)
    bev = top.modifiers.new("round", "BEVEL")
    bev.width = 0.06
    bev.segments = 6
    link(finish(top, grass), None, group)
    bush = mat("bush", (0.26, 0.6, 0.24), 0.8, sheen=0.2)
    for x, y in [(-5.0, -1.0), (5.2, -1.2), (-2.0, -3.4)]:
        sphere((x, y, 0.2), (0.35, 0.3, 0.28), bush, group=group, seg=20)
    colors = [(1.0, 0.6, 0.72), (1.0, 0.88, 0.45), (0.78, 0.66, 1.0), (1.0, 1.0, 1.0)]
    for i, (x, y) in enumerate([(-3.8, 0.4), (-2.4, 2.0), (2.6, 2.0), (3.4, -0.4), (0.6, 3.0), (-0.4, -3.2), (4.6, 0.4), (1.0, -3.0)]):
        sphere((x, y, 0.12), (0.1, 0.1, 0.07), mat(f"flower{i % 4}", colors[i % 4], 0.5), group=group, seg=12)
        sphere((x, y, 0.17), (0.04, 0.04, 0.03), mat("flower_center", (1.0, 0.85, 0.3), 0.5), group=group, seg=8)
    tree((-2.6, 3.3, 0), 1.0, group)
    tree((4.6, 1.6, 0), 0.85, group)


def fence(group):
    wood = mat("wood", (0.86, 0.66, 0.46), 0.7, noise=((0.78, 0.58, 0.4), 10))
    for i in range(5):
        rcyl((-3.6 + i * 1.25, -2.85, 0.42), 0.11, 0.8, wood, group=group)
    for z in (0.36, 0.66):
        rcube((-1.1, -2.85, z), (2.6, 0.06, 0.06), wood, group=group, round_width=0.05)


def trough(group):
    wood = mat("wood", (0.86, 0.66, 0.46), 0.7, noise=((0.78, 0.58, 0.4), 10))
    water = mat("water", (0.45, 0.78, 0.95), 0.1)
    rcube((-3.0, -1.7, 0.17), (0.55, 0.28, 0.16), wood, group=group, round_width=0.07)
    rcube((-3.0, -1.7, 0.34), (0.44, 0.18, 0.03), water, group=group, round_width=0.02)


def hut(group):
    wall = mat("hut_wall", (1.0, 0.93, 0.8), 0.7)
    roof = mat("hut_roof", (0.95, 0.45, 0.45), 0.55)
    door = mat("hut_door", (0.62, 0.42, 0.3), 0.7)
    window = mat("window", (1.0, 0.85, 0.5), 0.3, emission=WINDOW_GLOW)
    x, y = -4.3, 1.4
    rcube((x, y, 0.5), (0.65, 0.55, 0.5), wall, group=group, round_width=0.08)
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=1.05, radius2=0, depth=0.75, location=(x, y, 1.35), rotation=(0, 0, math.radians(45)))
    r = bpy.context.active_object
    bev = r.modifiers.new("round", "BEVEL")
    bev.width = 0.08
    bev.segments = 4
    link(finish(r, roof, smooth=False), None, group)
    rcube((x + 0.66, y - 0.15, 0.36), (0.02, 0.18, 0.3), door, group=group, round_width=0.02)
    rcube((x + 0.66, y + 0.28, 0.6), (0.02, 0.12, 0.12), window, group=group, round_width=0.02)


def flower_bed(group):
    soil = mat("bed_soil", (0.55, 0.36, 0.24), 0.9)
    colors = [(1.0, 0.5, 0.66), (1.0, 0.86, 0.36), (0.72, 0.6, 1.0), (1.0, 0.98, 0.98), (1.0, 0.62, 0.42)]
    cx, cy = 3.7, -1.5
    rcyl((cx, cy, 0.08), 0.85, 0.14, soil, group=group, vertices=32)
    i = 0
    for ring, count in ((0.0, 1), (0.35, 6), (0.65, 10)):
        for k in range(count):
            a = 2 * math.pi * k / max(count, 1)
            x = cx + ring * math.cos(a)
            y = cy + ring * math.sin(a) * 0.8
            rcyl((x, y, 0.28), 0.025, 0.3, mat("stem", (0.3, 0.62, 0.3), 0.7), group=group, vertices=8)
            sphere((x, y, 0.46), (0.11, 0.11, 0.09), mat(f"bed_flower{i % 5}", colors[i % 5], 0.5), group=group, seg=12)
            i += 1


def windmill(group):
    wall = mat("mill_wall", (0.98, 0.95, 0.9), 0.7)
    roof = mat("mill_roof", (0.55, 0.62, 0.95), 0.55)
    blade = mat("mill_blade", (1.0, 0.98, 0.96), 0.6)
    x, y = 4.9, -0.4
    rcone((x, y, 1.0), 0.55, 2.0, wall, group=group, tip=0.7)
    rcone((x, y, 2.25), 0.5, 0.6, roof, group=group, tip=0.05)
    hub = empty((x - 0.45, y - 0.45, 1.75), rot=(0, 0, math.radians(-45)), group=group)
    sphere((0, 0, 0), (0.1, 0.1, 0.1), roof, hub, group, seg=12)
    for k in range(4):
        arm = empty((0, 0, 0), rot=(math.radians(90 * k + 20), 0, 0), parent=hub, group=group)
        rcube((0.05, 0, 0.55), (0.02, 0.14, 0.5), blade, parent=arm, group=group, round_width=0.02)


def pond(group):
    edge = mat("pond_edge", (0.86, 0.82, 0.76), 0.8)
    water = mat("pond_water", (0.4, 0.74, 0.95), 0.08)
    lily = mat("lily", (0.3, 0.7, 0.35), 0.6)
    cx, cy = 1.9, -2.7
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.95, depth=0.1, location=(cx, cy, 0.06))
    p = bpy.context.active_object
    p.scale = (1.3, 0.85, 1)
    bpy.ops.object.transform_apply(scale=True)
    link(finish(p, water), None, group)
    for k in range(14):
        a = 2 * math.pi * k / 14
        sphere((cx + 1.3 * 0.98 * math.cos(a), cy + 0.85 * 0.98 * math.sin(a), 0.1), (0.16, 0.16, 0.1), edge, group=group, seg=12)
    for dx, dy in ((0.3, 0.1), (-0.4, -0.15)):
        rcyl((cx + dx, cy + dy, 0.13), 0.16, 0.02, lily, group=group, vertices=16)


def barn(group):
    wall = mat("barn_wall", (0.92, 0.4, 0.38), 0.65)
    trim = mat("barn_trim", (1.0, 0.97, 0.92), 0.6)
    roof = mat("barn_roof", (0.45, 0.32, 0.3), 0.6)
    window = mat("window", (1.0, 0.85, 0.5), 0.3, emission=WINDOW_GLOW)
    x, y = 0.2, 3.5
    rcube((x, y, 0.75), (1.1, 0.8, 0.75), wall, group=group, round_width=0.08)
    # 切妻: 戸口（+x）の面に三角の壁を見せ、棟は x に沿わせる。
    gable = mesh_object("barn_gable", [
        (x - 1.08, y - 0.8, 1.48), (x - 1.08, y + 0.8, 1.48), (x - 1.08, y, 2.2),
        (x + 1.08, y - 0.8, 1.48), (x + 1.08, y + 0.8, 1.48), (x + 1.08, y, 2.2),
    ], [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], wall, group)
    gable.modifiers.new("round", "BEVEL").width = 0.03
    roof_obj = mesh_object("barn_roof", [
        (x - 1.25, y, 2.28), (x + 1.25, y, 2.28),
        (x - 1.25, y - 1.0, 1.4), (x + 1.25, y - 1.0, 1.4),
        (x - 1.25, y + 1.0, 1.4), (x + 1.25, y + 1.0, 1.4),
    ], [(0, 1, 3, 2), (0, 4, 5, 1)], roof, group)
    thick = roof_obj.modifiers.new("thick", "SOLIDIFY")
    thick.thickness = 0.1
    roof_obj.modifiers.new("round", "BEVEL").width = 0.03
    rcube((x + 1.11, y, 0.5), (0.02, 0.38, 0.48), trim, group=group, round_width=0.02)
    rcube((x + 1.12, y, 0.5), (0.02, 0.3, 0.4), mat("barn_door", (0.8, 0.32, 0.3), 0.7), group=group, round_width=0.02)
    rcube((x + 1.1, y, 1.75), (0.02, 0.16, 0.14), window, group=group, round_width=0.02)


def clock_tower(group):
    wall = mat("tower_wall", (1.0, 0.95, 0.86), 0.65)
    roof = mat("tower_roof", (0.36, 0.6, 0.5), 0.55)
    face_m = mat("clock_face", (1.0, 1.0, 0.97), 0.4, emission=WINDOW_GLOW * 0.4)
    hand = mat("clock_hand", (0.25, 0.2, 0.2), 0.4)
    x, y = -5.0, -0.1
    rcube((x, y, 1.2), (0.42, 0.42, 1.2), wall, group=group, round_width=0.08)
    rcone((x, y, 2.75), 0.62, 0.9, roof, group=group, tip=0.05, vertices=4)
    clock = empty((x + 0.43, y, 1.85), rot=(0, math.radians(90), 0), group=group)
    rcyl((0, 0, 0), 0.28, 0.05, face_m, parent=clock, group=group, vertices=32)
    rcube((0.0, 0.0, 0.04), (0.03, 0.015, 0.16), hand, parent=clock, group=group, round_width=0.01)
    rcube((0.08, 0.0, 0.04), (0.11, 0.015, 0.03), hand, parent=clock, group=group, round_width=0.01)


def golden_statue(group):
    gold = mat("gold", (1.0, 0.78, 0.3), 0.18)
    stone = mat("pedestal", (0.9, 0.88, 0.84), 0.7)
    x, y = -1.6, 2.2
    rcyl((x, y, 0.25), 0.55, 0.5, stone, group=group, vertices=32)
    holder = empty((x, y, 0.5), rot=(0, 0, math.radians(-35)), group=group)
    statue = []
    root = cow("stand", statue)
    root.parent = holder
    root.scale = (0.55, 0.55, 0.55)
    for obj in statue:
        # 目と光は残して、ほかを金にする（顔が分かるように）。
        if obj.type == "MESH" and not any(m and m.name in ("eye", "shine") for m in obj.data.materials):
            obj.data.materials.clear()
            obj.data.materials.append(gold)
        group.append(obj)


FACILITIES = [None, fence, trough, hut, flower_bed, windmill, pond, barn, clock_tower, golden_statue]


# ───────────── 立ち位置（地面の上、管理人の画面で動物が歩く場所） ─────────────
SPOTS = [
    (-0.7, 1), (-2.5, -1), (0.9, 2), (0.4, -2), (-0.5, 2.4), (1.9, -1.2),
    (-2.2, 0.5), (1.6, 1), (-0.9, -1.3), (3, 0.3), (0.5, -0.2), (2.6, -0.5),
]
# 柵の外を見る位置・杭の位置・干し草の位置（動物の右前に置く）
FENCE_SPOT = (-1.3, -2.25)
STAKE_SPOT = (-3.3, 0.6)


def set_visible(objects, visible):
    for obj in objects:
        obj.hide_render = not visible
        obj.hide_viewport = not visible


def camera(name, target, ortho, res_x, res_y):
    bpy.ops.object.camera_add(location=target - CAMERA_DIR * 20)
    cam = bpy.context.active_object
    cam.name = name
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = ortho
    cam.data.clip_end = 100
    cam.rotation_euler = CAMERA_DIR.to_track_quat("-Z", "Y").to_euler()
    return cam


def lighting():
    light_dir = {"day": Vector((-1.0, 0.35, 1.15)), "evening": Vector((-1.3, 0.9, 0.55)), "night": Vector((-0.6, 1.0, 1.2))}[TIME]
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 10))
    sun = bpy.context.active_object
    sun.data.energy = {"day": 3.2, "evening": 2.6, "night": 1.1}[TIME]
    sun.data.color = {"day": (1.0, 0.94, 0.82), "evening": (1.0, 0.68, 0.48), "night": (0.6, 0.7, 1.0)}[TIME]
    sun.data.angle = math.radians(22)
    sun.rotation_euler = (-light_dir).to_track_quat("-Z", "Y").to_euler()
    world = bpy.data.worlds.new("world")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = {"day": (0.85, 0.9, 1.0, 1), "evening": (0.95, 0.72, 0.72, 1), "night": (0.2, 0.25, 0.5, 1)}[TIME]
    bg.inputs["Strength"].default_value = {"day": 0.62, "evening": 0.5, "night": 0.4}[TIME]


def render(path, cam, res_x, res_y):
    scene.camera = cam
    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("WROTE", path)


def screen_point(cam, res_x, res_y, world):
    co = world_to_camera_view(scene, cam, Vector(world))
    return round(co.x, 4), round(1 - co.y, 4)


lighting()
scene.render.film_transparent = True
scene.render.image_settings.file_format = "WEBP"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.quality = 82
scene.view_settings.view_transform = "Standard"
try:
    scene.eevee.taa_render_samples = 64
    scene.eevee.use_raytracing = True
except AttributeError:
    pass

base = []
island(base)
levels = [[] for _ in FACILITIES]
for index, build in enumerate(FACILITIES):
    if build:
        build(levels[index])

scene_cam = camera("scene", Vector((0, 0, 1.15)), SCENE_ORTHO, SCENE_W, SCENE_H)
scene.render.resolution_x = SCENE_W
scene.render.resolution_y = SCENE_H
sprite_cam = camera("sprite", Vector((0, 0, 0.75)), SPRITE_ORTHO, SPRITE_PX, SPRITE_PX)

bpy.context.view_layer.update()

if LAYOUT_ONLY:
    scene.render.resolution_x = SCENE_W
    scene.render.resolution_y = SCENE_H
    layout = {
        "scene": {"width": SCENE_W, "height": SCENE_H, "ortho": SCENE_ORTHO},
        "sprite": {"size": SPRITE_PX, "ortho": SPRITE_ORTHO},
        "spots": [screen_point(scene_cam, SCENE_W, SCENE_H, (x, y, 0.06)) for x, y in SPOTS],
        "fence": screen_point(scene_cam, SCENE_W, SCENE_H, (*FENCE_SPOT, 0.06)),
        "stake": screen_point(scene_cam, SCENE_W, SCENE_H, (*STAKE_SPOT, 0.06)),
    }
    scene.render.resolution_x = SPRITE_PX
    scene.render.resolution_y = SPRITE_PX
    layout["sprite"]["foot"] = screen_point(sprite_cam, SPRITE_PX, SPRITE_PX, (0, 0, 0))
    print("LAYOUT " + json.dumps(layout))
    sys.exit(0)

# 背景: レベルごとに、そこまでの施設を出す。
everything = [obj for group in levels for obj in group]
for level in range(1, 11):
    set_visible(base, True)
    for index, group in enumerate(levels):
        set_visible(group, index < level)
    render(f"{OUT}/ranch-lv{level}-{TIME}.webp", scene_cam, SCENE_W, SCENE_H)

set_visible(base, False)
set_visible(everything, False)

# 動物と小物: 原点に1つずつ置いて描く。顔は画面の左下（見る人の方）へ向ける。
for kind, build in ANIMALS.items():
    for pose in POSES:
        group = []
        root = build(pose, group)
        root.rotation_euler[2] = math.radians(-30)
        render(f"{OUT}/{kind}-{pose}-{TIME}.webp", sprite_cam, SPRITE_PX, SPRITE_PX)
        set_visible(group, False)

for name, build in PROPS.items():
    group = []
    build(group)
    render(f"{OUT}/prop-{name}-{TIME}.webp", sprite_cam, SPRITE_PX, SPRITE_PX)
    set_visible(group, False)
