/**
 * 成都地铁业务对象类型
 *
 * 字段与后端 transport schema 中各表列一一对应：
 *  - MetroRouteProps  ← chengdu_metro_routes
 *  - MetroStopProps   ← chengdu_metro_stops_unique（去重物理站点）
 *  - MetroSegmentProps ← chengdu_metro_segments
 */

/** 地铁线路属性（chengdu_metro_routes） */
export interface MetroRouteProps {
  id: number
  route_cn: string
  route_en: string | null
  city_code: string | null
  route_type: string | null
  type_en: string | null
  company_cn: string | null
  company_en: string | null
  /** 起点站中文名 */
  s_stop_cn: string | null
  s_stop_en: string | null
  /** 终点站中文名 */
  e_stop_cn: string | null
  e_stop_en: string | null
  /** 线路里程（km） */
  distance: string | null
  /** 站点总数 */
  total_stop: number | null
  /** 首班车时间 HHMM */
  start_time: string | null
  /** 末班车时间 HHMM */
  end_time: string | null
  /** 是否环线 0/1 */
  loop: string | number | null
  /** 运营状态码（1=运营中，3=规划/未开通） */
  status: string | number | null
  /** 起步票价（元） */
  basic_prc: string | null
  /** 全程票价（元） */
  total_prc: string | null
  city_cn: string | null
  city_en: string | null
  merged_cnt: number | null
  /** 几何计算长度（km） */
  length: number | null
}

/** 去重物理站点属性（chengdu_metro_stops_unique） */
export interface MetroStopProps {
  id: number
  stop_cn: string
  stop_en: string | null
  stop_id: string
  city_cn: string | null
  city_en: string | null
  /** 所属区县（后端按区县边界空间定位得出，市域外为 null） */
  district: string | null
  /** 途经线路（已归一化，如「地铁1号线」） */
  lines: MetroStopLine[]
  /** 途经线路条数（换乘站识别） */
  line_count: number
}

/** 站间区间段属性（chengdu_metro_segments） */
export interface MetroSegmentProps {
  id: number
  s_stop_cn: string | null
  s_stop_en: string | null
  s_stopid: string | null
  e_stop_cn: string | null
  e_stop_en: string | null
  e_stopid: string | null
  /** 区间距离（km） */
  distance: number | null
  city_cn: string | null
  city_en: string | null
  num: number | null
}

/** 线路方向站点属性（chengdu_metro_stops，按线路方向展开） */
export interface MetroRouteStopProps {
  id: number
  /** 站点中文名（该表字段名为 name_cn） */
  name_cn: string
  name_en: string | null
  stop_id: string
  route_cn: string | null
  route_en: string | null
  route_id: string | null
  /** 在线路上的序号（1 起） */
  sequence: number | null
  merged_cnt: number | null
}

/** 单站途经线路（后端已按线路归一化） */
export interface MetroStopLine {
  /** 归一化线路名，如「地铁1号线」 */
  name: string
  /** 该站所在的具体方向，如「地铁1号线(韦家碾--科学城)」 */
  directions: string[]
}
