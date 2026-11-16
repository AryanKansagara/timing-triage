// Excerpt of quartus/MCU.sta.rpt from https://github.com/nanamake/avr_cpu (commit b557e64f47).
// Copyright (c) 2018 NAMAKE Nanamaru, MIT License. Report written by Quartus II 14.0 Web Edition.
// Shortened: path tables keep their 25 worst rows per corner and the I/O timing tables are left out.
// Nothing else is changed.
export const AVR_CPU_STA = `TimeQuest Timing Analyzer report for MCU
Sat Oct 27 17:29:50 2018
Quartus II 64-Bit Version 14.0.0 Build 200 06/17/2014 SJ Web Edition


+-------------------------------------------------------------------------+
; TimeQuest Timing Analyzer Summary                                       ;
+--------------------+----------------------------------------------------+
; Quartus II Version ; Version 14.0.0 Build 200 06/17/2014 SJ Web Edition ;
; Revision Name      ; MCU                                                ;
; Device Family      ; Cyclone IV E                                       ;
; Device Name        ; EP4CE22F17C6                                       ;
; Timing Models      ; Final                                              ;
; Delay Model        ; Combined                                           ;
; Rise/Fall Delays   ; Enabled                                            ;
+--------------------+----------------------------------------------------+


Parallel compilation was disabled, but you have multiple processors available. Enable parallel compilation to reduce compilation time.
+-------------------------------------+
; Parallel Compilation                ;
+----------------------------+--------+
; Processors                 ; Number ;
+----------------------------+--------+
; Number detected on machine ; 4      ;
; Maximum allowed            ; 1      ;
+----------------------------+--------+


+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
; Clocks                                                                                                                                                                            ;
+------------+------+--------+------------+-------+-------+------------+-----------+-------------+-------+--------+-----------+------------+----------+--------+--------+-----------+
; Clock Name ; Type ; Period ; Frequency  ; Rise  ; Fall  ; Duty Cycle ; Divide by ; Multiply by ; Phase ; Offset ; Edge List ; Edge Shift ; Inverted ; Master ; Source ; Targets   ;
+------------+------+--------+------------+-------+-------+------------+-----------+-------------+-------+--------+-----------+------------+----------+--------+--------+-----------+
; clock      ; Base ; 1.000  ; 1000.0 MHz ; 0.000 ; 0.500 ;            ;           ;             ;       ;        ;           ;            ;          ;        ;        ; { clock } ;
+------------+------+--------+------------+-------+-------+------------+-----------+-------------+-------+--------+-----------+------------+----------+--------+--------+-----------+


+-------------------------------------------------+
; Slow 1200mV 85C Model Fmax Summary              ;
+-----------+-----------------+------------+------+
; Fmax      ; Restricted Fmax ; Clock Name ; Note ;
+-----------+-----------------+------------+------+
; 63.52 MHz ; 63.52 MHz       ; clock      ;      ;
+-----------+-----------------+------------+------+
This panel reports FMAX for every clock in the design, regardless of the user-specified clock periods.  FMAX is only computed for paths where the source and destination registers or ports are driven by the same clock.  Paths of different clocks, including generated clocks, are ignored.  For paths between a clock and its inversion, FMAX is computed as if the rising and falling edges are scaled along with FMAX, such that the duty cycle (in terms of a percentage) is maintained. Altera recommends that you always use clock constraints and other slack reports for sign-off analysis.


----------------------------------
; Timing Closure Recommendations ;
----------------------------------
HTML report is unavailable in plain text report export.


+-------------------------------------+
; Slow 1200mV 85C Model Setup Summary ;
+-------+---------+-------------------+
; Clock ; Slack   ; End Point TNS     ;
+-------+---------+-------------------+
; clock ; -14.744 ; -5828.793         ;
+-------+---------+-------------------+


+------------------------------------+
; Slow 1200mV 85C Model Hold Summary ;
+-------+-------+--------------------+
; Clock ; Slack ; End Point TNS      ;
+-------+-------+--------------------+
; clock ; 0.343 ; 0.000              ;
+-------+-------+--------------------+


------------------------------------------
; Slow 1200mV 85C Model Recovery Summary ;
------------------------------------------
No paths to report.


-----------------------------------------
; Slow 1200mV 85C Model Removal Summary ;
-----------------------------------------
No paths to report.


+---------------------------------------------------+
; Slow 1200mV 85C Model Minimum Pulse Width Summary ;
+-------+--------+----------------------------------+
; Clock ; Slack  ; End Point TNS                    ;
+-------+--------+----------------------------------+
; clock ; -3.000 ; -761.902                         ;
+-------+--------+----------------------------------+


+---------------------------------------------------------------------------------------------------------------------------------------------+
; Slow 1200mV 85C Model Setup: 'clock'                                                                                                        ;
+---------+----------------------------+--------------------------------+--------------+-------------+--------------+------------+------------+
; Slack   ; From Node                  ; To Node                        ; Launch Clock ; Latch Clock ; Relationship ; Clock Skew ; Data Delay ;
+---------+----------------------------+--------------------------------+--------------+-------------+--------------+------------+------------+
; -14.744 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[10]   ; clock        ; clock       ; 1.000        ; 0.273      ; 16.012     ;
; -14.744 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[2]    ; clock        ; clock       ; 1.000        ; 0.273      ; 16.012     ;
; -14.709 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|SregAndSp:SAS|sp[10]   ; clock        ; clock       ; 1.000        ; 0.280      ; 15.984     ;
; -14.709 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|SregAndSp:SAS|sp[2]    ; clock        ; clock       ; 1.000        ; 0.280      ; 15.984     ;
; -14.707 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[13]   ; clock        ; clock       ; 1.000        ; 0.307      ; 16.009     ;
; -14.707 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[5]    ; clock        ; clock       ; 1.000        ; 0.307      ; 16.009     ;
; -14.672 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|SregAndSp:SAS|sp[13]   ; clock        ; clock       ; 1.000        ; 0.314      ; 15.981     ;
; -14.672 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|SregAndSp:SAS|sp[5]    ; clock        ; clock       ; 1.000        ; 0.314      ; 15.981     ;
; -14.667 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sr_nf    ; clock        ; clock       ; 1.000        ; 0.247      ; 15.909     ;
; -14.667 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sr_sf    ; clock        ; clock       ; 1.000        ; 0.247      ; 15.909     ;
; -14.667 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sr_vf    ; clock        ; clock       ; 1.000        ; 0.247      ; 15.909     ;
; -14.651 ; CPU:CPU|PcAndIr:PAI|ir[15] ; CPU:CPU|SregAndSp:SAS|sp[10]   ; clock        ; clock       ; 1.000        ; 0.273      ; 15.919     ;
; -14.651 ; CPU:CPU|PcAndIr:PAI|ir[15] ; CPU:CPU|SregAndSp:SAS|sp[2]    ; clock        ; clock       ; 1.000        ; 0.273      ; 15.919     ;
; -14.632 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|SregAndSp:SAS|sr_nf    ; clock        ; clock       ; 1.000        ; 0.254      ; 15.881     ;
; -14.632 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|SregAndSp:SAS|sr_sf    ; clock        ; clock       ; 1.000        ; 0.254      ; 15.881     ;
; -14.632 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|SregAndSp:SAS|sr_vf    ; clock        ; clock       ; 1.000        ; 0.254      ; 15.881     ;
; -14.614 ; CPU:CPU|PcAndIr:PAI|ir[15] ; CPU:CPU|SregAndSp:SAS|sp[13]   ; clock        ; clock       ; 1.000        ; 0.307      ; 15.916     ;
; -14.614 ; CPU:CPU|PcAndIr:PAI|ir[15] ; CPU:CPU|SregAndSp:SAS|sp[5]    ; clock        ; clock       ; 1.000        ; 0.307      ; 15.916     ;
; -14.605 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[7]    ; clock        ; clock       ; 1.000        ; 0.239      ; 15.839     ;
; -14.605 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[15]   ; clock        ; clock       ; 1.000        ; 0.239      ; 15.839     ;
; -14.605 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[4]    ; clock        ; clock       ; 1.000        ; 0.239      ; 15.839     ;
; -14.605 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[12]   ; clock        ; clock       ; 1.000        ; 0.239      ; 15.839     ;
; -14.574 ; CPU:CPU|PcAndIr:PAI|ir[15] ; CPU:CPU|SregAndSp:SAS|sr_nf    ; clock        ; clock       ; 1.000        ; 0.247      ; 15.816     ;
; -14.574 ; CPU:CPU|PcAndIr:PAI|ir[15] ; CPU:CPU|SregAndSp:SAS|sr_sf    ; clock        ; clock       ; 1.000        ; 0.247      ; 15.816     ;
; -14.574 ; CPU:CPU|PcAndIr:PAI|ir[15] ; CPU:CPU|SregAndSp:SAS|sr_vf    ; clock        ; clock       ; 1.000        ; 0.247      ; 15.816     ;
+---------+----------------------------+--------------------------------+--------------+-------------+--------------+------------+------------+


+------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
; Slow 1200mV 85C Model Hold: 'clock'                                                                                                                                                                        ;
+-------+--------------------------------+---------------------------------------------------------------------------------------------+--------------+-------------+--------------+------------+------------+
; Slack ; From Node                      ; To Node                                                                                     ; Launch Clock ; Latch Clock ; Relationship ; Clock Skew ; Data Delay ;
+-------+--------------------------------+---------------------------------------------------------------------------------------------+--------------+-------------+--------------+------------+------------+
; 0.343 ; CPU:CPU|PcAndIr:PAI|cycle[1]   ; CPU:CPU|PcAndIr:PAI|cycle[1]                                                                ; clock        ; clock       ; 0.000        ; 0.077      ; 0.577      ;
; 0.346 ; CPU:CPU|PcAndIr:PAI|cycle[0]   ; CPU:CPU|PcAndIr:PAI|cycle[0]                                                                ; clock        ; clock       ; 0.000        ; 0.077      ; 0.580      ;
; 0.501 ; CPU:CPU|PcAndIr:PAI|as_reset   ; CPU:CPU|PcAndIr:PAI|sy_reset                                                                ; clock        ; clock       ; 0.000        ; 0.077      ; 0.735      ;
; 0.598 ; CPU:CPU|DmCont:DMC|dm_addr[4]  ; RAM:DM|altsyncram:mem_rtl_0|altsyncram_9f81:auto_generated|ram_block1a0~porta_address_reg0  ; clock        ; clock       ; -0.500       ; 0.565      ; 0.870      ;
; 0.599 ; CPU:CPU|PcAndIr:PAI|skp_2nd    ; CPU:CPU|PmCont:PMC|lpm_re_l                                                                 ; clock        ; clock       ; 0.000        ; 0.076      ; 0.832      ;
; 0.611 ; CPU:CPU|PcAndIr:PAI|skp_2nd    ; CPU:CPU|PmCont:PMC|lpm_re_h                                                                 ; clock        ; clock       ; 0.000        ; 0.076      ; 0.844      ;
; 0.626 ; CPU:CPU|PmCont:PMC|pm_addr[1]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a26~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.553      ; 0.886      ;
; 0.642 ; CPU:CPU|PmCont:PMC|pm_addr[1]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a25~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.540      ; 0.889      ;
; 0.645 ; CPU:CPU|PmCont:PMC|pm_addr[11] ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a10~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.553      ; 0.905      ;
; 0.649 ; CPU:CPU|PmCont:PMC|pm_addr[9]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a26~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.555      ; 0.911      ;
; 0.653 ; i_irq_addr[14]                 ; CPU:CPU|PcAndIr:PAI|pc[14]                                                                  ; clock        ; clock       ; 0.000        ; 0.063      ; 0.873      ;
; 0.655 ; i_irq                          ; CPU:CPU|PcAndIr:PAI|irq_det_1d                                                              ; clock        ; clock       ; 0.000        ; 0.053      ; 0.865      ;
; 0.656 ; CPU:CPU|DmCont:DMC|dm_addr[2]  ; RAM:DM|altsyncram:mem_rtl_0|altsyncram_9f81:auto_generated|ram_block1a0~porta_address_reg0  ; clock        ; clock       ; -0.500       ; 0.565      ; 0.928      ;
; 0.809 ; CPU:CPU|PmCont:PMC|pm_addr[4]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a26~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.548      ; 1.064      ;
; 0.821 ; CPU:CPU|PmCont:PMC|pm_addr[4]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a25~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.535      ; 1.063      ;
; 0.835 ; CPU:CPU|PmCont:PMC|pm_addr[4]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a9~porta_address_reg0  ; clock        ; clock       ; -0.500       ; 0.554      ; 1.096      ;
; 0.844 ; CPU:CPU|DmCont:DMC|dm_addr[10] ; RAM:DM|altsyncram:mem_rtl_0|altsyncram_9f81:auto_generated|ram_block1a0~porta_address_reg0  ; clock        ; clock       ; -0.500       ; 0.569      ; 1.120      ;
; 0.846 ; CPU:CPU|DmCont:DMC|dm_addr[1]  ; RAM:DM|altsyncram:mem_rtl_0|altsyncram_9f81:auto_generated|ram_block1a0~porta_address_reg0  ; clock        ; clock       ; -0.500       ; 0.565      ; 1.118      ;
; 0.852 ; CPU:CPU|SregAndSp:SAS|sp[9]    ; CPU:CPU|SregAndSp:SAS|sp[9]                                                                 ; clock        ; clock       ; 0.000        ; 0.076      ; 1.085      ;
; 0.858 ; CPU:CPU|SregAndSp:SAS|sp[11]   ; CPU:CPU|SregAndSp:SAS|sp[11]                                                                ; clock        ; clock       ; 0.000        ; 0.076      ; 1.091      ;
; 0.859 ; CPU:CPU|SregAndSp:SAS|sr_cf    ; CPU:CPU|SregAndSp:SAS|sr_cf                                                                 ; clock        ; clock       ; 0.000        ; 0.077      ; 1.093      ;
; 0.864 ; CPU:CPU|PmCont:PMC|pm_addr[2]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a26~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.553      ; 1.124      ;
; 0.865 ; CPU:CPU|PmCont:PMC|pm_addr[4]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a14~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.557      ; 1.129      ;
; 0.871 ; CPU:CPU|PmCont:PMC|pm_wdata[8] ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a8~porta_datain_reg0   ; clock        ; clock       ; -0.500       ; 0.547      ; 1.125      ;
; 0.875 ; CPU:CPU|PmCont:PMC|pm_addr[3]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a19~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.547      ; 1.129      ;
+-------+--------------------------------+---------------------------------------------------------------------------------------------+--------------+-------------+--------------+------------+------------+


----------------------------------------------
; Slow 1200mV 85C Model Metastability Report ;
----------------------------------------------
No synchronizer chains to report.


+-------------------------------------------------+
; Slow 1200mV 0C Model Fmax Summary               ;
+-----------+-----------------+------------+------+
; Fmax      ; Restricted Fmax ; Clock Name ; Note ;
+-----------+-----------------+------------+------+
; 70.59 MHz ; 70.59 MHz       ; clock      ;      ;
+-----------+-----------------+------------+------+
This panel reports FMAX for every clock in the design, regardless of the user-specified clock periods.  FMAX is only computed for paths where the source and destination registers or ports are driven by the same clock.  Paths of different clocks, including generated clocks, are ignored.  For paths between a clock and its inversion, FMAX is computed as if the rising and falling edges are scaled along with FMAX, such that the duty cycle (in terms of a percentage) is maintained. Altera recommends that you always use clock constraints and other slack reports for sign-off analysis.


+------------------------------------+
; Slow 1200mV 0C Model Setup Summary ;
+-------+---------+------------------+
; Clock ; Slack   ; End Point TNS    ;
+-------+---------+------------------+
; clock ; -13.166 ; -5210.939        ;
+-------+---------+------------------+


+-----------------------------------+
; Slow 1200mV 0C Model Hold Summary ;
+-------+-------+-------------------+
; Clock ; Slack ; End Point TNS     ;
+-------+-------+-------------------+
; clock ; 0.299 ; 0.000             ;
+-------+-------+-------------------+


-----------------------------------------
; Slow 1200mV 0C Model Recovery Summary ;
-----------------------------------------
No paths to report.


----------------------------------------
; Slow 1200mV 0C Model Removal Summary ;
----------------------------------------
No paths to report.


+--------------------------------------------------+
; Slow 1200mV 0C Model Minimum Pulse Width Summary ;
+-------+--------+---------------------------------+
; Clock ; Slack  ; End Point TNS                   ;
+-------+--------+---------------------------------+
; clock ; -3.000 ; -761.686                        ;
+-------+--------+---------------------------------+


+---------------------------------------------------------------------------------------------------------------------------------------------+
; Slow 1200mV 0C Model Setup: 'clock'                                                                                                         ;
+---------+----------------------------+--------------------------------+--------------+-------------+--------------+------------+------------+
; Slack   ; From Node                  ; To Node                        ; Launch Clock ; Latch Clock ; Relationship ; Clock Skew ; Data Delay ;
+---------+----------------------------+--------------------------------+--------------+-------------+--------------+------------+------------+
; -13.166 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[10]   ; clock        ; clock       ; 1.000        ; 0.244      ; 14.405     ;
; -13.166 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[2]    ; clock        ; clock       ; 1.000        ; 0.244      ; 14.405     ;
; -13.127 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|SregAndSp:SAS|sp[10]   ; clock        ; clock       ; 1.000        ; 0.251      ; 14.373     ;
; -13.127 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|SregAndSp:SAS|sp[2]    ; clock        ; clock       ; 1.000        ; 0.251      ; 14.373     ;
; -13.125 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[13]   ; clock        ; clock       ; 1.000        ; 0.274      ; 14.394     ;
; -13.125 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[5]    ; clock        ; clock       ; 1.000        ; 0.274      ; 14.394     ;
; -13.108 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sr_nf    ; clock        ; clock       ; 1.000        ; 0.220      ; 14.323     ;
; -13.108 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sr_sf    ; clock        ; clock       ; 1.000        ; 0.220      ; 14.323     ;
; -13.108 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sr_vf    ; clock        ; clock       ; 1.000        ; 0.220      ; 14.323     ;
; -13.086 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|SregAndSp:SAS|sp[13]   ; clock        ; clock       ; 1.000        ; 0.281      ; 14.362     ;
; -13.086 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|SregAndSp:SAS|sp[5]    ; clock        ; clock       ; 1.000        ; 0.281      ; 14.362     ;
; -13.078 ; CPU:CPU|PcAndIr:PAI|ir[15] ; CPU:CPU|SregAndSp:SAS|sp[10]   ; clock        ; clock       ; 1.000        ; 0.244      ; 14.317     ;
; -13.078 ; CPU:CPU|PcAndIr:PAI|ir[15] ; CPU:CPU|SregAndSp:SAS|sp[2]    ; clock        ; clock       ; 1.000        ; 0.244      ; 14.317     ;
; -13.069 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|SregAndSp:SAS|sr_nf    ; clock        ; clock       ; 1.000        ; 0.227      ; 14.291     ;
; -13.069 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|SregAndSp:SAS|sr_sf    ; clock        ; clock       ; 1.000        ; 0.227      ; 14.291     ;
; -13.069 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|SregAndSp:SAS|sr_vf    ; clock        ; clock       ; 1.000        ; 0.227      ; 14.291     ;
; -13.038 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[7]    ; clock        ; clock       ; 1.000        ; 0.210      ; 14.243     ;
; -13.038 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[15]   ; clock        ; clock       ; 1.000        ; 0.210      ; 14.243     ;
; -13.038 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[4]    ; clock        ; clock       ; 1.000        ; 0.210      ; 14.243     ;
; -13.038 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[12]   ; clock        ; clock       ; 1.000        ; 0.210      ; 14.243     ;
; -13.037 ; CPU:CPU|PcAndIr:PAI|ir[15] ; CPU:CPU|SregAndSp:SAS|sp[13]   ; clock        ; clock       ; 1.000        ; 0.274      ; 14.306     ;
; -13.037 ; CPU:CPU|PcAndIr:PAI|ir[15] ; CPU:CPU|SregAndSp:SAS|sp[5]    ; clock        ; clock       ; 1.000        ; 0.274      ; 14.306     ;
; -13.029 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|DmCont:DMC|dm_wdata[0] ; clock        ; clock       ; 1.000        ; 0.239      ; 14.263     ;
; -13.029 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|DmCont:DMC|dm_wdata[1] ; clock        ; clock       ; 1.000        ; 0.239      ; 14.263     ;
; -13.029 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|DmCont:DMC|dm_wdata[5] ; clock        ; clock       ; 1.000        ; 0.239      ; 14.263     ;
+---------+----------------------------+--------------------------------+--------------+-------------+--------------+------------+------------+


+------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
; Slow 1200mV 0C Model Hold: 'clock'                                                                                                                                                                         ;
+-------+--------------------------------+---------------------------------------------------------------------------------------------+--------------+-------------+--------------+------------+------------+
; Slack ; From Node                      ; To Node                                                                                     ; Launch Clock ; Latch Clock ; Relationship ; Clock Skew ; Data Delay ;
+-------+--------------------------------+---------------------------------------------------------------------------------------------+--------------+-------------+--------------+------------+------------+
; 0.299 ; CPU:CPU|PcAndIr:PAI|cycle[1]   ; CPU:CPU|PcAndIr:PAI|cycle[1]                                                                ; clock        ; clock       ; 0.000        ; 0.068      ; 0.511      ;
; 0.307 ; CPU:CPU|PcAndIr:PAI|cycle[0]   ; CPU:CPU|PcAndIr:PAI|cycle[0]                                                                ; clock        ; clock       ; 0.000        ; 0.068      ; 0.519      ;
; 0.452 ; CPU:CPU|PcAndIr:PAI|as_reset   ; CPU:CPU|PcAndIr:PAI|sy_reset                                                                ; clock        ; clock       ; 0.000        ; 0.068      ; 0.664      ;
; 0.535 ; CPU:CPU|PcAndIr:PAI|skp_2nd    ; CPU:CPU|PmCont:PMC|lpm_re_l                                                                 ; clock        ; clock       ; 0.000        ; 0.068      ; 0.747      ;
; 0.541 ; CPU:CPU|PcAndIr:PAI|skp_2nd    ; CPU:CPU|PmCont:PMC|lpm_re_h                                                                 ; clock        ; clock       ; 0.000        ; 0.068      ; 0.753      ;
; 0.601 ; i_irq_addr[14]                 ; CPU:CPU|PcAndIr:PAI|pc[14]                                                                  ; clock        ; clock       ; 0.000        ; 0.055      ; 0.800      ;
; 0.604 ; i_irq                          ; CPU:CPU|PcAndIr:PAI|irq_det_1d                                                              ; clock        ; clock       ; 0.000        ; 0.045      ; 0.793      ;
; 0.626 ; CPU:CPU|DmCont:DMC|dm_addr[4]  ; RAM:DM|altsyncram:mem_rtl_0|altsyncram_9f81:auto_generated|ram_block1a0~porta_address_reg0  ; clock        ; clock       ; -0.500       ; 0.494      ; 0.809      ;
; 0.642 ; CPU:CPU|PmCont:PMC|pm_addr[1]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a26~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.486      ; 0.817      ;
; 0.659 ; CPU:CPU|PmCont:PMC|pm_addr[11] ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a10~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.485      ; 0.833      ;
; 0.660 ; CPU:CPU|PmCont:PMC|pm_addr[1]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a25~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.472      ; 0.821      ;
; 0.663 ; CPU:CPU|PmCont:PMC|pm_addr[9]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a26~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.488      ; 0.840      ;
; 0.679 ; CPU:CPU|DmCont:DMC|dm_addr[2]  ; RAM:DM|altsyncram:mem_rtl_0|altsyncram_9f81:auto_generated|ram_block1a0~porta_address_reg0  ; clock        ; clock       ; -0.500       ; 0.494      ; 0.862      ;
; 0.769 ; CPU:CPU|SregAndSp:SAS|sp[9]    ; CPU:CPU|SregAndSp:SAS|sp[9]                                                                 ; clock        ; clock       ; 0.000        ; 0.068      ; 0.981      ;
; 0.775 ; CPU:CPU|SregAndSp:SAS|sp[11]   ; CPU:CPU|SregAndSp:SAS|sp[11]                                                                ; clock        ; clock       ; 0.000        ; 0.068      ; 0.987      ;
; 0.780 ; CPU:CPU|SregAndSp:SAS|sr_cf    ; CPU:CPU|SregAndSp:SAS|sr_cf                                                                 ; clock        ; clock       ; 0.000        ; 0.068      ; 0.992      ;
; 0.811 ; CPU:CPU|PmCont:PMC|pm_addr[4]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a26~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.481      ; 0.981      ;
; 0.823 ; CPU:CPU|SregAndSp:SAS|sp[7]    ; CPU:CPU|SregAndSp:SAS|sp[7]                                                                 ; clock        ; clock       ; 0.000        ; 0.067      ; 1.034      ;
; 0.825 ; CPU:CPU|PmCont:PMC|pm_addr[4]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a25~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.467      ; 0.981      ;
; 0.834 ; CPU:CPU|PmCont:PMC|pm_addr[4]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a9~porta_address_reg0  ; clock        ; clock       ; -0.500       ; 0.486      ; 1.009      ;
; 0.839 ; i_irq_addr[6]                  ; CPU:CPU|PcAndIr:PAI|pc[6]                                                                   ; clock        ; clock       ; 0.000        ; 0.079      ; 1.062      ;
; 0.861 ; CPU:CPU|DmCont:DMC|dm_addr[1]  ; RAM:DM|altsyncram:mem_rtl_0|altsyncram_9f81:auto_generated|ram_block1a0~porta_address_reg0  ; clock        ; clock       ; -0.500       ; 0.494      ; 1.044      ;
; 0.861 ; CPU:CPU|DmCont:DMC|dm_addr[10] ; RAM:DM|altsyncram:mem_rtl_0|altsyncram_9f81:auto_generated|ram_block1a0~porta_address_reg0  ; clock        ; clock       ; -0.500       ; 0.497      ; 1.047      ;
; 0.862 ; CPU:CPU|PmCont:PMC|pm_addr[4]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a14~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.486      ; 1.037      ;
; 0.867 ; CPU:CPU|PmCont:PMC|pm_addr[2]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a26~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.486      ; 1.042      ;
+-------+--------------------------------+---------------------------------------------------------------------------------------------+--------------+-------------+--------------+------------+------------+


---------------------------------------------
; Slow 1200mV 0C Model Metastability Report ;
---------------------------------------------
No synchronizer chains to report.


+------------------------------------+
; Fast 1200mV 0C Model Setup Summary ;
+-------+--------+-------------------+
; Clock ; Slack  ; End Point TNS     ;
+-------+--------+-------------------+
; clock ; -8.028 ; -3089.259         ;
+-------+--------+-------------------+


+-----------------------------------+
; Fast 1200mV 0C Model Hold Summary ;
+-------+-------+-------------------+
; Clock ; Slack ; End Point TNS     ;
+-------+-------+-------------------+
; clock ; 0.179 ; 0.000             ;
+-------+-------+-------------------+


-----------------------------------------
; Fast 1200mV 0C Model Recovery Summary ;
-----------------------------------------
No paths to report.


----------------------------------------
; Fast 1200mV 0C Model Removal Summary ;
----------------------------------------
No paths to report.


+--------------------------------------------------+
; Fast 1200mV 0C Model Minimum Pulse Width Summary ;
+-------+--------+---------------------------------+
; Clock ; Slack  ; End Point TNS                   ;
+-------+--------+---------------------------------+
; clock ; -3.000 ; -675.187                        ;
+-------+--------+---------------------------------+


+--------------------------------------------------------------------------------------------------------------------------------------------+
; Fast 1200mV 0C Model Setup: 'clock'                                                                                                        ;
+--------+----------------------------+--------------------------------+--------------+-------------+--------------+------------+------------+
; Slack  ; From Node                  ; To Node                        ; Launch Clock ; Latch Clock ; Relationship ; Clock Skew ; Data Delay ;
+--------+----------------------------+--------------------------------+--------------+-------------+--------------+------------+------------+
; -8.028 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[10]   ; clock        ; clock       ; 1.000        ; 0.142      ; 9.157      ;
; -8.028 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[2]    ; clock        ; clock       ; 1.000        ; 0.142      ; 9.157      ;
; -8.010 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|SregAndSp:SAS|sp[10]   ; clock        ; clock       ; 1.000        ; 0.146      ; 9.143      ;
; -8.010 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|SregAndSp:SAS|sp[2]    ; clock        ; clock       ; 1.000        ; 0.146      ; 9.143      ;
; -8.006 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[13]   ; clock        ; clock       ; 1.000        ; 0.158      ; 9.151      ;
; -8.006 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[5]    ; clock        ; clock       ; 1.000        ; 0.158      ; 9.151      ;
; -8.000 ; CPU:CPU|PcAndIr:PAI|ir[15] ; CPU:CPU|SregAndSp:SAS|sp[10]   ; clock        ; clock       ; 1.000        ; 0.142      ; 9.129      ;
; -8.000 ; CPU:CPU|PcAndIr:PAI|ir[15] ; CPU:CPU|SregAndSp:SAS|sp[2]    ; clock        ; clock       ; 1.000        ; 0.142      ; 9.129      ;
; -7.988 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|SregAndSp:SAS|sp[13]   ; clock        ; clock       ; 1.000        ; 0.162      ; 9.137      ;
; -7.988 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|SregAndSp:SAS|sp[5]    ; clock        ; clock       ; 1.000        ; 0.162      ; 9.137      ;
; -7.986 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|DmCont:DMC|dm_wdata[0] ; clock        ; clock       ; 1.000        ; 0.137      ; 9.110      ;
; -7.986 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|DmCont:DMC|dm_wdata[1] ; clock        ; clock       ; 1.000        ; 0.137      ; 9.110      ;
; -7.986 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|DmCont:DMC|dm_wdata[5] ; clock        ; clock       ; 1.000        ; 0.137      ; 9.110      ;
; -7.978 ; CPU:CPU|PcAndIr:PAI|ir[15] ; CPU:CPU|SregAndSp:SAS|sp[13]   ; clock        ; clock       ; 1.000        ; 0.158      ; 9.123      ;
; -7.978 ; CPU:CPU|PcAndIr:PAI|ir[15] ; CPU:CPU|SregAndSp:SAS|sp[5]    ; clock        ; clock       ; 1.000        ; 0.158      ; 9.123      ;
; -7.968 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|DmCont:DMC|dm_wdata[0] ; clock        ; clock       ; 1.000        ; 0.141      ; 9.096      ;
; -7.968 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|DmCont:DMC|dm_wdata[1] ; clock        ; clock       ; 1.000        ; 0.141      ; 9.096      ;
; -7.968 ; CPU:CPU|PcAndIr:PAI|ir[3]  ; CPU:CPU|DmCont:DMC|dm_wdata[5] ; clock        ; clock       ; 1.000        ; 0.141      ; 9.096      ;
; -7.958 ; CPU:CPU|PcAndIr:PAI|ir[15] ; CPU:CPU|DmCont:DMC|dm_wdata[0] ; clock        ; clock       ; 1.000        ; 0.137      ; 9.082      ;
; -7.958 ; CPU:CPU|PcAndIr:PAI|ir[15] ; CPU:CPU|DmCont:DMC|dm_wdata[1] ; clock        ; clock       ; 1.000        ; 0.137      ; 9.082      ;
; -7.958 ; CPU:CPU|PcAndIr:PAI|ir[15] ; CPU:CPU|DmCont:DMC|dm_wdata[5] ; clock        ; clock       ; 1.000        ; 0.137      ; 9.082      ;
; -7.951 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[7]    ; clock        ; clock       ; 1.000        ; 0.122      ; 9.060      ;
; -7.951 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[15]   ; clock        ; clock       ; 1.000        ; 0.122      ; 9.060      ;
; -7.951 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[4]    ; clock        ; clock       ; 1.000        ; 0.122      ; 9.060      ;
; -7.951 ; CPU:CPU|PcAndIr:PAI|ir[11] ; CPU:CPU|SregAndSp:SAS|sp[12]   ; clock        ; clock       ; 1.000        ; 0.122      ; 9.060      ;
+--------+----------------------------+--------------------------------+--------------+-------------+--------------+------------+------------+


+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
; Fast 1200mV 0C Model Hold: 'clock'                                                                                                                                                                          ;
+-------+---------------------------------+---------------------------------------------------------------------------------------------+--------------+-------------+--------------+------------+------------+
; Slack ; From Node                       ; To Node                                                                                     ; Launch Clock ; Latch Clock ; Relationship ; Clock Skew ; Data Delay ;
+-------+---------------------------------+---------------------------------------------------------------------------------------------+--------------+-------------+--------------+------------+------------+
; 0.179 ; CPU:CPU|PcAndIr:PAI|cycle[1]    ; CPU:CPU|PcAndIr:PAI|cycle[1]                                                                ; clock        ; clock       ; 0.000        ; 0.044      ; 0.307      ;
; 0.186 ; CPU:CPU|PcAndIr:PAI|cycle[0]    ; CPU:CPU|PcAndIr:PAI|cycle[0]                                                                ; clock        ; clock       ; 0.000        ; 0.044      ; 0.314      ;
; 0.240 ; CPU:CPU|DmCont:DMC|dm_addr[4]   ; RAM:DM|altsyncram:mem_rtl_0|altsyncram_9f81:auto_generated|ram_block1a0~porta_address_reg0  ; clock        ; clock       ; -0.500       ; 0.613      ; 0.477      ;
; 0.252 ; CPU:CPU|PmCont:PMC|pm_addr[1]   ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a26~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.606      ; 0.482      ;
; 0.259 ; CPU:CPU|PcAndIr:PAI|as_reset    ; CPU:CPU|PcAndIr:PAI|sy_reset                                                                ; clock        ; clock       ; 0.000        ; 0.044      ; 0.387      ;
; 0.262 ; CPU:CPU|PmCont:PMC|pm_addr[11]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a10~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.607      ; 0.493      ;
; 0.264 ; CPU:CPU|DmCont:DMC|dm_addr[2]   ; RAM:DM|altsyncram:mem_rtl_0|altsyncram_9f81:auto_generated|ram_block1a0~porta_address_reg0  ; clock        ; clock       ; -0.500       ; 0.613      ; 0.501      ;
; 0.265 ; CPU:CPU|PmCont:PMC|pm_addr[9]   ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a26~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.607      ; 0.496      ;
; 0.269 ; CPU:CPU|PmCont:PMC|pm_addr[1]   ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a25~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.596      ; 0.489      ;
; 0.320 ; CPU:CPU|PcAndIr:PAI|skp_2nd     ; CPU:CPU|PmCont:PMC|lpm_re_l                                                                 ; clock        ; clock       ; 0.000        ; 0.044      ; 0.448      ;
; 0.328 ; CPU:CPU|PcAndIr:PAI|skp_2nd     ; CPU:CPU|PmCont:PMC|lpm_re_h                                                                 ; clock        ; clock       ; 0.000        ; 0.044      ; 0.456      ;
; 0.335 ; i_irq_addr[14]                  ; CPU:CPU|PcAndIr:PAI|pc[14]                                                                  ; clock        ; clock       ; 0.000        ; 0.036      ; 0.455      ;
; 0.337 ; i_irq                           ; CPU:CPU|PcAndIr:PAI|irq_det_1d                                                              ; clock        ; clock       ; 0.000        ; 0.033      ; 0.454      ;
; 0.362 ; CPU:CPU|PmCont:PMC|pm_addr[4]   ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a26~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.603      ; 0.589      ;
; 0.363 ; CPU:CPU|PmCont:PMC|pm_addr[4]   ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a9~porta_address_reg0  ; clock        ; clock       ; -0.500       ; 0.607      ; 0.594      ;
; 0.371 ; CPU:CPU|PmCont:PMC|pm_addr[2]   ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a26~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.605      ; 0.600      ;
; 0.372 ; CPU:CPU|PmCont:PMC|pm_addr[4]   ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a25~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.593      ; 0.589      ;
; 0.374 ; CPU:CPU|DmCont:DMC|dm_addr[10]  ; RAM:DM|altsyncram:mem_rtl_0|altsyncram_9f81:auto_generated|ram_block1a0~porta_address_reg0  ; clock        ; clock       ; -0.500       ; 0.616      ; 0.614      ;
; 0.381 ; CPU:CPU|DmCont:DMC|dm_addr[1]   ; RAM:DM|altsyncram:mem_rtl_0|altsyncram_9f81:auto_generated|ram_block1a0~porta_address_reg0  ; clock        ; clock       ; -0.500       ; 0.613      ; 0.618      ;
; 0.391 ; CPU:CPU|PmCont:PMC|pm_addr[3]   ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a19~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.603      ; 0.618      ;
; 0.396 ; CPU:CPU|PmCont:PMC|pm_wdata[8]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a8~porta_datain_reg0   ; clock        ; clock       ; -0.500       ; 0.602      ; 0.622      ;
; 0.396 ; CPU:CPU|PmCont:PMC|pm_addr[4]   ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a14~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.607      ; 0.627      ;
; 0.399 ; CPU:CPU|PmCont:PMC|pm_addr[4]   ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a19~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.603      ; 0.626      ;
; 0.404 ; CPU:CPU|PmCont:PMC|pm_wdata[6]  ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a6~porta_datain_reg0   ; clock        ; clock       ; -0.500       ; 0.619      ; 0.647      ;
; 0.406 ; CPU:CPU|PmCont:PMC|pm_addr[9]   ; RAM:PM|altsyncram:mem_rtl_0|altsyncram_ji81:auto_generated|ram_block1a25~porta_address_reg0 ; clock        ; clock       ; -0.500       ; 0.597      ; 0.627      ;
+-------+---------------------------------+---------------------------------------------------------------------------------------------+--------------+-------------+--------------+------------+------------+


---------------------------------------------
; Fast 1200mV 0C Model Metastability Report ;
---------------------------------------------
No synchronizer chains to report.


+---------------------------------------------------------------------------------+
; Multicorner Timing Analysis Summary                                             ;
+------------------+-----------+-------+----------+---------+---------------------+
; Clock            ; Setup     ; Hold  ; Recovery ; Removal ; Minimum Pulse Width ;
+------------------+-----------+-------+----------+---------+---------------------+
; Worst-case Slack ; -14.744   ; 0.179 ; N/A      ; N/A     ; -3.000              ;
;  clock           ; -14.744   ; 0.179 ; N/A      ; N/A     ; -3.000              ;
; Design-wide TNS  ; -5828.793 ; 0.0   ; 0.0      ; 0.0     ; -761.902            ;
;  clock           ; -5828.793 ; 0.000 ; N/A      ; N/A     ; -761.902            ;
+------------------+-----------+-------+----------+---------+---------------------+


+--------------------------------------------------------------------+
; Setup Transfers                                                    ;
+------------+----------+-----------+----------+----------+----------+
; From Clock ; To Clock ; RR Paths  ; FR Paths ; RF Paths ; FF Paths ;
+------------+----------+-----------+----------+----------+----------+
; clock      ; clock    ; 306330552 ; 1918     ; 641      ; 0        ;
+------------+----------+-----------+----------+----------+----------+
Entries labeled "false path" only account for clock-to-clock false paths and not path-based false paths. As a result, actual path counts may be lower than reported.


+--------------------------------------------------------------------+
; Hold Transfers                                                     ;
+------------+----------+-----------+----------+----------+----------+
; From Clock ; To Clock ; RR Paths  ; FR Paths ; RF Paths ; FF Paths ;
+------------+----------+-----------+----------+----------+----------+
; clock      ; clock    ; 306330552 ; 1918     ; 641      ; 0        ;
+------------+----------+-----------+----------+----------+----------+
Entries labeled "false path" only account for clock-to-clock false paths and not path-based false paths. As a result, actual path counts may be lower than reported.


---------------
; Report TCCS ;
---------------
No dedicated SERDES Transmitter circuitry present in device or used in design


---------------
; Report RSKM ;
---------------
No non-DPA dedicated SERDES Receiver circuitry present in device or used in design


+------------------------------------------------+
; Unconstrained Paths                            ;
+---------------------------------+-------+------+
; Property                        ; Setup ; Hold ;
+---------------------------------+-------+------+
; Illegal Clocks                  ; 0     ; 0    ;
; Unconstrained Clocks            ; 0     ; 0    ;
; Unconstrained Input Ports       ; 18    ; 18   ;
; Unconstrained Input Port Paths  ; 251   ; 251  ;
; Unconstrained Output Ports      ; 8     ; 8    ;
; Unconstrained Output Port Paths ; 8     ; 8    ;
+---------------------------------+-------+------+


+------------------------------------+
; TimeQuest Timing Analyzer Messages ;
+------------------------------------+
Info: *******************************************************************
Info: Running Quartus II 64-Bit TimeQuest Timing Analyzer
    Info: Version 14.0.0 Build 200 06/17/2014 SJ Web Edition
    Info: Processing started: Sat Oct 27 17:29:45 2018
Info: Command: quartus_sta MCU -c MCU
Info: qsta_default_script.tcl version: #1
Warning (20028): Parallel compilation is not licensed and has been disabled
Info (21076): High junction temperature operating condition is not set. Assuming a default value of '85'.
Info (21076): Low junction temperature operating condition is not set. Assuming a default value of '0'.
Critical Warning (332012): Synopsys Design Constraints File file not found: 'MCU.sdc'. A Synopsys Design Constraints File is required by the TimeQuest Timing Analyzer to get proper timing constraints. Without it, the Compiler will not properly optimize the design.
Info (332142): No user constrained base clocks found in the design. Calling "derive_clocks -period 1.0"
Info (332105): Deriving Clocks
    Info (332105): create_clock -period 1.000 -name clock clock
Info (332143): No user constrained clock uncertainty found in the design. Calling "derive_clock_uncertainty"
Info (332123): Deriving Clock Uncertainty. Please refer to report_sdc in TimeQuest to see clock uncertainties.
Info: Found TIMEQUEST_REPORT_SCRIPT_INCLUDE_DEFAULT_ANALYSIS = ON
Info: Analyzing Slow 1200mV 85C Model
Critical Warning (332148): Timing requirements not met
    Info (11105): For recommendations on closing timing, run Report Timing Closure Recommendations in the TimeQuest Timing Analyzer.
Info (332146): Worst-case setup slack is -14.744
    Info (332119):     Slack       End Point TNS Clock 
    Info (332119): ========= =================== =====================
    Info (332119):   -14.744           -5828.793 clock 
Info (332146): Worst-case hold slack is 0.343
    Info (332119):     Slack       End Point TNS Clock 
    Info (332119): ========= =================== =====================
    Info (332119):     0.343               0.000 clock 
Info (332140): No Recovery paths to report
Info (332140): No Removal paths to report
Info (332146): Worst-case minimum pulse width slack is -3.000
    Info (332119):     Slack       End Point TNS Clock 
    Info (332119): ========= =================== =====================
    Info (332119):    -3.000            -761.902 clock 
Info: Analyzing Slow 1200mV 0C Model
Info (334003): Started post-fitting delay annotation
Info (334004): Delay annotation completed successfully
Info (332123): Deriving Clock Uncertainty. Please refer to report_sdc in TimeQuest to see clock uncertainties.
Critical Warning (332148): Timing requirements not met
    Info (11105): For recommendations on closing timing, run Report Timing Closure Recommendations in the TimeQuest Timing Analyzer.
Info (332146): Worst-case setup slack is -13.166
    Info (332119):     Slack       End Point TNS Clock 
    Info (332119): ========= =================== =====================
    Info (332119):   -13.166           -5210.939 clock 
Info (332146): Worst-case hold slack is 0.299
    Info (332119):     Slack       End Point TNS Clock 
    Info (332119): ========= =================== =====================
    Info (332119):     0.299               0.000 clock 
Info (332140): No Recovery paths to report
Info (332140): No Removal paths to report
Info (332146): Worst-case minimum pulse width slack is -3.000
    Info (332119):     Slack       End Point TNS Clock 
    Info (332119): ========= =================== =====================
    Info (332119):    -3.000            -761.686 clock 
Info: Analyzing Fast 1200mV 0C Model
Info (332123): Deriving Clock Uncertainty. Please refer to report_sdc in TimeQuest to see clock uncertainties.
Critical Warning (332148): Timing requirements not met
    Info (11105): For recommendations on closing timing, run Report Timing Closure Recommendations in the TimeQuest Timing Analyzer.
Info (332146): Worst-case setup slack is -8.028
    Info (332119):     Slack       End Point TNS Clock 
    Info (332119): ========= =================== =====================
    Info (332119):    -8.028           -3089.259 clock 
Info (332146): Worst-case hold slack is 0.179
    Info (332119):     Slack       End Point TNS Clock 
    Info (332119): ========= =================== =====================
    Info (332119):     0.179               0.000 clock 
Info (332140): No Recovery paths to report
Info (332140): No Removal paths to report
Info (332146): Worst-case minimum pulse width slack is -3.000
    Info (332119):     Slack       End Point TNS Clock 
    Info (332119): ========= =================== =====================
    Info (332119):    -3.000            -675.187 clock 
Info (332102): Design is not fully constrained for setup requirements
Info (332102): Design is not fully constrained for hold requirements
Info: Quartus II 64-Bit TimeQuest Timing Analyzer was successful. 0 errors, 5 warnings
    Info: Peak virtual memory: 558 megabytes
    Info: Processing ended: Sat Oct 27 17:29:50 2018
    Info: Elapsed time: 00:00:05
    Info: Total CPU time (on all processors): 00:00:05


`
