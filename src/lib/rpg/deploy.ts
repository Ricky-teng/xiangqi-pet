// src/lib/rpg/deploy.ts

/**
 * 出戰單位的組裝
 * ------------------------------------------------------------
 * 把「一隻小雞」（收藏的或正在養的）轉成戰鬥模擬器吃的 BattleUnit，
 * 順便產出畫面要用的 visual。探險跟戰隊共用這一支，確保兩邊算出來的
 * 數值一定一樣。
 *
 * 「正在養的那一隻」跟收藏小雞的差別只有資料放在哪：前者在
 * pets/{uid}，數值依當下的職業與生大病次數即時算，會隨轉職、生病
 * 變動；後者在 collectedPets 子集合，收藏當下就定型了。
 * 這支函式把兩者統一成同一個形狀，上層就不用到處寫 if。
 */

import type { PetDoc } from "@/types/database";
import type { CollectedPetDoc } from "@/types/rpg";
import type { BattleUnit } from "@/lib/rpg/battle";
import type { BattleUnitVisual } from "@/components/battle/BattleStage";
import type { MonsterTemplate } from "@/lib/rpg/monsters";
import {
  getCombatTraits,
  getDeployBlockReason,
  getItemType,
  type ArmorType,
  type CombatTraits,
  type EquipmentItem,
  type WeaponType,
} from "@/lib/rpg/equipment";
import { getFinalStats, getTotalPower, type PetStats } from "@/lib/rpg/stats";
import { getBossSkill, isSkillBoosted, isSkillId, type SkillId, type UnitSkill } from "@/lib/rpg/skills";

/** 畫面上用來代表「一隻可以出戰的小雞」的統一形狀 */
export interface DeployablePet {
  /** 收藏小雞是文件 id；正在養的那隻固定是 LIVING_PET_ID */
  id: string;
  /** true = 正在養的那一隻（數值還會變動） */
  isLiving: boolean;
  name: string;
  jobId: string | null;
  severeSickCount: number;
  weapon: EquipmentItem | null;
  armor: EquipmentItem | null;
  stats: PetStats;
  /** 裝備跟寶石帶來的特殊效果（爆擊、吸血…） */
  traits: CombatTraits;
  /** 總戰力（含特殊效果的估值） */
  totalPower: number;
  /** 不能出戰的原因，null = 可以出戰 */
  blockReason: string | null;
  /** 技能（只有收藏小雞有；正在養的那隻是 null） */
  skillId: SkillId | null;
  /** 技能跟職業搭配上了（效果 +30%、冷卻 −20%） */
  skillBoosted: boolean;
}

/** 正在養的那一隻在畫面上的固定 id */
export const LIVING_PET_ID = "__living__";

function build(
  id: string,
  isLiving: boolean,
  name: string,
  jobId: string | null,
  severeSickCount: number,
  weapon: EquipmentItem | null,
  armor: EquipmentItem | null,
  skillId: SkillId | null = null,
): DeployablePet {
  const stats = getFinalStats(jobId, severeSickCount, weapon, armor);
  const traits = getCombatTraits(weapon, armor);
  return {
    id,
    isLiving,
    name,
    jobId,
    severeSickCount,
    weapon,
    armor,
    stats,
    traits,
    totalPower: getTotalPower(stats, traits),
    blockReason: getDeployBlockReason(weapon),
    skillId,
    skillBoosted: skillId ? isSkillBoosted(skillId, jobId) : false,
  };
}

export function fromCollectedPet(pet: CollectedPetDoc): DeployablePet {
  const skillId = isSkillId(pet.skillId) ? pet.skillId : null;
  return build(pet.id, false, pet.name, pet.jobId, pet.severeSickCount, pet.weapon, pet.armor, skillId);
}

/**
 * 把「正在養的那一隻」包成可出戰的形狀。
 * 只有長到大師雞、而且還活著才算——蛋跟雛雞本來就不該上戰場。
 * 生病中照樣可以出戰（規格拍板），所以這裡不看 healthStatus 的病情。
 */
export function fromLivingPet(pet: PetDoc | null): DeployablePet | null {
  if (!pet) return null;
  if (pet.stage !== "master") return null;
  if (pet.healthStatus === "dead") return null;
  return build(
    LIVING_PET_ID,
    true,
    "養成中的小雞",
    pet.currentAppearanceId,
    pet.severeSickCount ?? 0,
    pet.weapon ?? null,
    pet.armor ?? null,
  );
}

/** 一位學生目前所有可以挑來出戰的小雞（收藏的 ＋ 正在養的） */
export function getDeployablePets(
  collected: CollectedPetDoc[],
  living: PetDoc | null,
): DeployablePet[] {
  const livingPet = fromLivingPet(living);
  return [...(livingPet ? [livingPet] : []), ...collected.map(fromCollectedPet)];
}

// ============================================================
// 轉成戰鬥單位
// ============================================================

/**
 * @param statBonus 四項一起加幾成（探險的「當天解題加成」，戰隊不給）
 */
export function toBattleUnit(pet: DeployablePet, id: string, side: "player" | "enemy", statBonus = 0): BattleUnit {
  const k = 1 + statBonus;
  const skill: UnitSkill | null = pet.skillId ? { id: pet.skillId, boosted: pet.skillBoosted } : null;
  return {
    id,
    side,
    name: pet.name,
    maxHp: Math.round(pet.stats.hp * k),
    attack: Math.round(pet.stats.attack * k),
    defense: Math.round(pet.stats.defense * k),
    speed: Math.round(pet.stats.speed * k),
    traits: pet.traits,
    skill,
  };
}

export function toBattleVisual(pet: DeployablePet, id: string): BattleUnitVisual {
  return {
    id,
    jobId: pet.jobId,
    // 戰鬥畫面依武器種類換刀光樣式、依防具種類畫閃避／反傷特效
    // getItemType 對武器一定回傳武器種類、防具一定回傳防具種類（見 equipment.ts）
    weaponType: pet.weapon ? (getItemType(pet.weapon) as WeaponType) : null,
    armorType: pet.armor ? (getItemType(pet.armor) as ArmorType) : null,
  };
}

export function monsterToBattleUnit(monster: MonsterTemplate, id: string): BattleUnit {
  // 只有 Boss 有技能：每座塔一個，血量剩一半才第一次放
  const isBoss = monster.id.endsWith("-boss");
  return {
    skill: isBoss ? { id: getBossSkill(monster.tower), boosted: false, bossTrigger: true } : null,
    id,
    side: "enemy",
    name: monster.name,
    emoji: monster.emoji,
    maxHp: monster.stats.hp,
    attack: monster.stats.attack,
    defense: monster.stats.defense,
    speed: monster.stats.speed,
  };
}

export function monsterToBattleVisual(monster: MonsterTemplate, id: string): BattleUnitVisual {
  return {
    id,
    emoji: monster.emoji,
    // 戰鬥畫面用程式繪製怪物（MonsterArt），依塔號＋體型決定長相
    monster: {
      tower: monster.tower,
      archetype: monster.archetype,
      isBoss: monster.id.endsWith("-boss"),
    },
  };
}

// ============================================================
// 打輸時的具體建議
// ============================================================

/**
 * 打輸之後告訴學生「差在哪」。
 *
 * 探險的勝率幾乎沒有中間值（打倒一隻回 30% 血，讓結果變成確定的），
 * 所以「再接再厲」這種話完全沒用——學生打輸就是真的數值不夠，直接
 * 指出是攻擊不足還是撐不住比較有幫助。
 *
 * 判斷方式：比較「我幾刀砍死 Boss」跟「Boss 幾刀砍死我」。
 */
export function getLoseHint(pet: DeployablePet, boss: MonsterTemplate): string {
  const myDamage = (pet.stats.attack * pet.stats.attack) / (pet.stats.attack + boss.stats.defense);
  const bossDamage =
    (boss.stats.attack * boss.stats.attack) / (boss.stats.attack + pet.stats.defense);

  const hitsToKillBoss = boss.stats.hp / Math.max(1, myDamage);
  const hitsToKillMe = pet.stats.hp / Math.max(1, bossDamage);

  if (hitsToKillBoss > hitsToKillMe * 1.6) {
    return `你的攻擊 ${pet.stats.attack} 打 ${boss.name}（防禦 ${boss.stats.defense}），一刀只有 ${Math.round(
      myDamage,
    )} 傷害，要砍 ${Math.ceil(hitsToKillBoss)} 刀才打得倒。先去合成更高階的武器吧。`;
  }
  if (hitsToKillMe < hitsToKillBoss * 0.8) {
    return `你撐不住 ${boss.name} 的攻擊——牠一刀 ${Math.round(bossDamage)} 傷害，你 ${
      pet.stats.hp
    } 點體力只能撐 ${Math.ceil(hitsToKillMe)} 刀。先去合成更高階的防具吧。`;
  }
  return `差一點點！你要砍 ${Math.ceil(hitsToKillBoss)} 刀才打得倒 ${boss.name}，但只撐得住 ${Math.ceil(
    hitsToKillMe,
  )} 刀。武器或防具升一階就有機會了。`;
}
